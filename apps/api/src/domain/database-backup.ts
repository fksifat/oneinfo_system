import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = z.object({ id: z.uuid(), fileName: z.string().regex(/^oneinfo-database-[0-9TZ-]+-[a-f0-9-]+\.dump$/), createdAt: z.iso.datetime(),
  database: z.string(), source: z.enum(["SSH/VPS", "Docker", "PostgreSQL"]), bytes: z.number().int().min(6), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type DatabaseBackup = z.infer<typeof schema>;
export const backupDirectory = () => process.env.ONEINFO_BACKUP_DIR ?? join(root, ".oneinfo/backups/database");
export function backupPath(id: string) { return join(backupDirectory(), `${z.uuid().parse(id)}.dump`); }

export function databaseDumpCommand(databaseUrl: string, env = process.env) {
  const url = new URL(databaseUrl), database = decodeURIComponent(url.pathname.slice(1)), user = decodeURIComponent(url.username);
  if (!database || !user) throw new Error("Database/user is missing");
  const args = ["--format=custom", "--no-owner", "--no-privileges", "--lock-wait-timeout=10s", `--username=${user}`, `--dbname=${database}`];
  if (env.ONEINFO_DATABASE_SSH) {
    if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.ONEINFO_DATABASE_SSH) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(env.ONEINFO_DATABASE_CONTAINER ?? "")) throw new Error("Invalid SSH database settings");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("SSH database must use the local tunnel");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const command = ["docker", "exec", env.ONEINFO_DATABASE_CONTAINER!, "pg_dump", ...args].map(quote).join(" ");
    return { command: "ssh", args: ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", env.ONEINFO_DATABASE_SSH, command], source: "SSH/VPS" as const, database, env };
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port === (env.ONEINFO_POSTGRES_PORT ?? "55432")) {
    return { command: "docker", args: ["compose", "-f", join(root, "compose.yaml"), "exec", "-T", "postgres", "pg_dump", ...args], source: "Docker" as const, database, env };
  }
  return { command: "pg_dump", args: [...args, `--host=${url.hostname.replace(/^\[|\]$/g, "")}`, `--port=${url.port || "5432"}`], source: "PostgreSQL" as const, database,
    env: { ...env, PGPASSWORD: decodeURIComponent(url.password), ...(url.searchParams.has("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode")! } : {}) } };
}

async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function createDatabaseBackup(databaseUrl: string): Promise<DatabaseBackup> {
  const plan = databaseDumpCommand(databaseUrl), id = randomUUID(), createdAt = new Date().toISOString();
  await mkdir(backupDirectory(), { recursive: true, mode: 0o700 });
  await chmod(backupDirectory(), 0o700);
  const partial = `${backupPath(id)}.partial`;
  const child = spawn(plan.command, plan.args, { env: plan.env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 600_000 });
  try {
    await Promise.all([
      pipeline(child.stdout!, createWriteStream(partial, { mode: 0o600, flags: "wx" })),
      new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error("Database dump command failed"))); }),
    ]);
    const file = await open(partial, "r");
    try {
      const signature = Buffer.alloc(5); await file.read(signature, 0, 5, 0);
      if (signature.toString() !== "PGDMP") throw new Error("Invalid PostgreSQL archive");
    } finally { await file.close(); }
    const metadata: DatabaseBackup = schema.parse({ id, createdAt, database: plan.database, source: plan.source,
      fileName: `oneinfo-database-${createdAt.replace(/[:.]/g, "-")}-${id}.dump`, bytes: (await stat(partial)).size, sha256: await checksum(partial) });
    await rename(partial, backupPath(id));
    const manifest = join(backupDirectory(), `${id}.json`);
    await writeFile(`${manifest}.partial`, JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
    await rename(`${manifest}.partial`, manifest);
    return metadata;
  } finally {
    if (child.exitCode === null && !child.killed) child.kill();
    await rm(partial, { force: true });
    await rm(join(backupDirectory(), `${id}.json.partial`), { force: true });
  }
}

export async function readDatabaseBackup(id: string, verify = false) {
  const path = backupPath(id);
  const metadata = schema.parse(JSON.parse(await readFile(join(backupDirectory(), `${id}.json`), "utf8")));
  if (metadata.id !== id || (await stat(path)).size !== metadata.bytes || (verify && await checksum(path) !== metadata.sha256)) throw new Error("Backup integrity check failed");
  return metadata;
}

export async function listDatabaseBackups() {
  const names = await readdir(backupDirectory()).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const records = await Promise.all(names.filter(name => z.uuid().safeParse(name.replace(/\.json$/, "")).success && name.endsWith(".json"))
    .map(async name => { try { return await readDatabaseBackup(name.slice(0, -5)); } catch { return null; } }));
  return records.filter((item): item is DatabaseBackup => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}

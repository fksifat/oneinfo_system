import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
import { backupPath, createDatabaseBackup, databaseDumpCommand, listDatabaseBackups, readDatabaseBackup } from "../src/domain/database-backup.js";
let directory = "";
afterEach(async () => { vi.unstubAllEnvs(); vi.clearAllMocks(); if (directory) await rm(directory, { recursive: true, force: true }); directory = ""; });

function dump(bytes: string, code = 0) {
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), exitCode: null as number | null, killed: false, kill: vi.fn() });
    setTimeout(() => { child.stdout.end(bytes); child.exitCode = code; child.emit("close", code); }, 5);
    return child;
  });
}
it("uses the configured database with safely quoted SSH arguments and no password in command arguments", () => {
  const plan = databaseDumpCommand("postgresql://oneinfo:private-password@127.0.0.1:55434/oneinfo", { ONEINFO_DATABASE_SSH: "root@192.0.2.1", ONEINFO_DATABASE_CONTAINER: "oneinfo-vps-postgres-1" });
  expect(plan.command).toBe("ssh");expect(plan.args.join(" ")).not.toContain("private-password");expect(plan.args.at(-1)).toContain("'--dbname=oneinfo'");
  expect(plan.args).toContain("StrictHostKeyChecking=yes");
  expect(() => databaseDumpCommand("postgresql://user:pass@localhost/db", { ONEINFO_DATABASE_SSH: "root@host;bad", ONEINFO_DATABASE_CONTAINER: "pg" })).toThrow("Invalid SSH");
  expect(() => databaseDumpCommand("postgresql://user:pass@remote/db", { ONEINFO_DATABASE_SSH: "root@host", ONEINFO_DATABASE_CONTAINER: "pg" })).toThrow("local tunnel");
  const native = databaseDumpCommand("postgresql://user:private-password@db.example:5432/database?sslmode=require", {});
  expect(native.command).toBe("pg_dump");expect(native.args.join(" ")).not.toContain("private-password");expect(native.env).toMatchObject({ PGPASSWORD: "private-password", PGSSLMODE: "require" });
  expect(databaseDumpCommand("postgresql://oneinfo:oneinfo@localhost:55432/test", {}).source).toBe("Docker");
  expect(databaseDumpCommand("postgresql://user:pass@[::1]:5432/test", {}).args).toContain("--host=::1");
});
it("retains complete archives and checksums, and rejects corrupt downloads without changing a previous backup", async () => {
  directory = await mkdtemp(join(tmpdir(), "oneinfo-backup-test-"));vi.stubEnv("ONEINFO_BACKUP_DIR", directory);vi.stubEnv("ONEINFO_DATABASE_SSH", "");
  // Synthetic archive only tests storage/integrity; the real pg_dump is restore-tested separately.
  dump("PGDMP synthetic backup bytes");
  const first = await createDatabaseBackup("postgresql://oneinfo:oneinfo@localhost:55432/test");
  expect(await readDatabaseBackup(first.id, true)).toEqual(first);expect(first.sha256).toHaveLength(64);
  expect(await readFile(backupPath(first.id), "utf8")).toBe("PGDMP synthetic backup bytes");
  expect(await listDatabaseBackups()).toEqual([first]);
  dump("partial data", 1);await expect(createDatabaseBackup("postgresql://oneinfo:oneinfo@localhost:55432/test")).rejects.toThrow();
  dump("not a postgres archive");await expect(createDatabaseBackup("postgresql://oneinfo:oneinfo@localhost:55432/test")).rejects.toThrow("Invalid PostgreSQL");
  expect((await readdir(directory)).some(name => name.endsWith(".partial"))).toBe(false);
  expect(await listDatabaseBackups()).toEqual([first]);
  await writeFile(backupPath(first.id), "PGDMP synthetic backup wrong");
  await expect(readDatabaseBackup(first.id, true)).rejects.toThrow("integrity");
  expect(() => backupPath("../../etc/passwd")).toThrow();
});

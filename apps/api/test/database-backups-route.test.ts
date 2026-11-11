import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ operator: vi.fn(), station: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("../src/auth.js", () => ({ requireOperator: mocks.operator, requireStation: mocks.station }));
vi.mock("../src/db/client.js", () => ({ db: { insert: () => ({ values: mocks.audit }) } }));
vi.mock("../src/domain/database-backup.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/domain/database-backup.js")>(), createDatabaseBackup: mocks.create }));
import { databaseBackupRoutes } from "../src/routes/database-backups.js";
let directory = "";
afterEach(async () => { vi.unstubAllEnvs();vi.resetAllMocks();if(directory)await rm(directory,{recursive:true,force:true});directory=""; });
async function setup() {
  directory=await mkdtemp(join(tmpdir(),"oneinfo-backup-route-"));vi.stubEnv("ONEINFO_BACKUP_DIR",directory);
  mocks.operator.mockResolvedValue({operatorId:randomUUID()});mocks.station.mockResolvedValue({stationId:randomUUID()});mocks.audit.mockResolvedValue(undefined);
  const app=Fastify();app.register(databaseBackupRoutes,{prefix:"/backups"});await app.ready();return app;
}
it("restricts exports to the PC socket and requires administrator and station authorization", async () => {
  const app=await setup();
  try {
    const lan=await app.inject({url:"/backups",remoteAddress:"192.0.2.2",headers:{"x-forwarded-for":"127.0.0.1"}});
    expect(lan.statusCode).toBe(403);expect(mocks.operator).not.toHaveBeenCalled();
    mocks.operator.mockRejectedValueOnce(Object.assign(new Error("Operator role is not permitted"),{statusCode:403}));
    expect((await app.inject("/backups")).statusCode).toBe(403);
    mocks.station.mockRejectedValueOnce(Object.assign(new Error("Invalid station"),{statusCode:401}));
    expect((await app.inject("/backups")).statusCode).toBe(401);
    const listed=await app.inject("/backups");expect(listed.statusCode).toBe(200);expect(listed.json().items).toEqual([]);
    expect(mocks.operator).toHaveBeenCalledWith(expect.anything(),["SUPER_ADMIN"]);
    expect(mocks.create).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
it("saves download metadata, blocks concurrent creation and returns only checksum-verified files", async () => {
  const app=await setup(),id=randomUUID(),bytes=Buffer.from("PGDMP synthetic archive");
  const backup={id,fileName:`oneinfo-database-2026-11-11T00-00-00-000Z-${id}.dump`,createdAt:"2026-11-11T00:00:00.000Z",database:"test",source:"Docker",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  await writeFile(join(directory,`${id}.dump`),bytes);await writeFile(join(directory,`${id}.json`),JSON.stringify(backup));
  let finish!:(value: typeof backup)=>void;
  mocks.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  try {
    const pending=app.inject({method:"POST",url:"/backups"});void pending.then(()=>undefined);
    await vi.waitFor(()=>expect(mocks.create).toHaveBeenCalledOnce());
    expect((await app.inject({method:"POST",url:"/backups"})).statusCode).toBe(409);
    finish(backup);expect((await pending).statusCode).toBe(201);expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:"DATABASE_BACKUP_CREATED",targetId:id}));
    const download=await app.inject(`/backups/${id}/download`);expect(download.statusCode).toBe(200);expect(download.rawPayload).toEqual(bytes);expect(download.headers["content-disposition"]).toContain(backup.fileName);
    await writeFile(join(directory,`${id}.dump`),"corrupted");expect((await app.inject(`/backups/${id}/download`)).statusCode).toBe(409);
    mocks.create.mockRejectedValueOnce(new Error("private credentials must not appear"));
    const failure=await app.inject({method:"POST",url:"/backups"});expect(failure.statusCode).toBe(503);expect(failure.body).not.toContain("private credentials");expect(failure.json().message).toContain("Existing backups are retained");
  } finally { await app.close(); }
});

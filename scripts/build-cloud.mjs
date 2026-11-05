import { cpSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { npmCommand } from "./start-local.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
rmSync(`${root}.cloud-dist`, { recursive: true, force: true });
const env = { ...process.env, VITE_API_URL: process.env.VITE_API_URL ?? "", VITE_STOREFRONT_URL: process.env.PUBLIC_SITE_URL ?? "https://oneinfo-system.vercel.app", VITE_OPERATOR_LOGIN: "password" };
for (const args of [
  ["run", "build", "--workspace", "@oneinfo/contracts"],
  ["run", "build:storefront"],
  ["exec", "--workspace", "@oneinfo/control-center", "--", "vite", "build", "--base=/dashboard/", "--outDir=../../.cloud-dist/dashboard"],
]) {
  const [binary, parameters] = npmCommand(args);
  const result = spawnSync(binary, parameters, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync(`${root}.cloud-dist`, { recursive: true });
cpSync(`${root}sites/storefront/dist`, `${root}.cloud-dist`, { recursive: true });

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: { fs: { deny: [".env", ".env.*", "*.{crt,pem,key,p12,pfx,cer,der}", ".npmrc", ".yarnrc.yml", "**/.git/**", "**/.oneinfo/**", "**/*.dump"] } },
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
});

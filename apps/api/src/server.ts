import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closeDatabase } from "./db/client.js";
import { fileURLToPath } from "node:url";
import { configureLanConnection, lanAddresses, loadLanIdentity } from "./domain/lan-connection.js";
import { Bonjour } from "bonjour-service";

import { drainOrderEmails } from "./domain/order-email-worker.js";

const app = buildApp();
let emailRun: Promise<void> | undefined;
const emailTimer = setInterval(() => {
  if (!emailRun) emailRun = drainOrderEmails().catch(() => app.log.error("Order email worker failed")).finally(() => { emailRun = undefined; });
}, 15_000);
emailTimer.unref();
let lan: ReturnType<typeof buildApp> | undefined;
let discovery: Bonjour | undefined;
let networkTimer: NodeJS.Timeout | undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  clearInterval(emailTimer);
  await emailRun;
  clearInterval(networkTimer);
  discovery?.unpublishAll(); discovery?.destroy();
  await lan?.close();
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  if (config.WORKSTATION_NFC_ENABLED) {
    const identity = await loadLanIdentity(fileURLToPath(new URL("../../../.oneinfo/lan-identity.json", import.meta.url)));
    lan = buildApp(identity);
    const connection = configureLanConnection(identity.cert, config.NFC_LAN_PORT);
    await lan.listen({ port: config.NFC_LAN_PORT, host: "0.0.0.0" });
    discovery = new Bonjour({}, (error: Error) => app.log.warn({ message: error.message }, "LAN discovery unavailable; pairing QR still works"));
    const publish = () => discovery!.publish({ name: `Oneinfo-${connection.fingerprint.slice(0, 12)}`, type: "oneinfo-nfc", port: config.NFC_LAN_PORT, txt: { fingerprint: connection.fingerprint } })
      .on("error", (error: Error) => app.log.warn({ message: error.message }, "LAN discovery could not advertise"));
    publish();
    let addresses = lanAddresses().join(",");
    networkTimer = setInterval(() => {
      const next = lanAddresses().join(",");
      if (next !== addresses) { addresses = next; discovery!.unpublishAll(() => publish()); }
    }, 15_000);
    networkTimer.unref();
    app.log.info({ port: config.NFC_LAN_PORT, addresses: lanAddresses() }, "Secure phone LAN connection ready");
  }
} catch (error) {
  app.log.error(error);
  clearInterval(emailTimer);
  await emailRun;
  clearInterval(networkTimer); discovery?.destroy();
  await lan?.close(); await app.close();
  await closeDatabase();
  process.exit(1);
}

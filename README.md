# Oneinfo QR and NFC Production System

This repository implements an end-to-end QR/NFC card platform from the technical specification. It includes a PostgreSQL-backed API, a production workstation, an administrative control center, and public client profiles linked to physical cards.

## Implemented vertical slice

- Transactional batch creation with one canonical public URL per card
- Separate QR generation, NFC encoding, and quality-control jobs
- Short-lived operator JWTs and independently revocable station credentials
- Atomic job claims with idempotency keys and station ownership
- QR artifact checksums and generation metadata
- Append-only NFC attempts with explicit failure categories
- Read-back hash comparison support
- QC gate that requires both generated QR and verified NFC output
- Automatic saleable-inventory release only after QC passes
- Card events and security-sensitive audit records
- React production console connected to a VS Code desktop NFC bridge
- Administrative dashboard for profiles, cards, batches, stations, and audit activity
- Client profile editor with publishing, contact information, theme, and social links
- Public mobile-friendly profile pages resolved by profile or card slug
- Assignment workflow that links a QC-passed card to a client and activates it
- PostgreSQL migrations, domain tests, and an end-to-end smoke test

## Deployment boundary

The NFC/QR management system is local-only. PostgreSQL, the API, admin control center, production console, and NFC bridge run from VS Code on the workstation. Real card encoding uses an NFC-capable Android phone over USB or a PC/SC-compatible USB NFC reader. Only the customer-facing selling website and published profile/card URLs need public hosting.

Product media uploaded in the control center is stored under the repository's `.product-media` directory by default and served by the API with immutable browser caching. Before publishing uploaded media, deploy the media endpoint on a customer-reachable host and set `PRODUCT_MEDIA_DIR` to persistent storage; the local workstation API binds to `127.0.0.1` and is not publicly reachable. Keep the production workstation private.

## Run locally

Requirements: Node.js 22.12 or newer and Docker.

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev:api
```

In a second terminal:

```bash
npm run dev:console
```

In a third terminal:

```bash
npm run dev:control
```

Local applications:

- Control center and profile management: `http://localhost:5174`
- Production workstation: `http://localhost:5173`
- API health: `http://localhost:3001/health`

The development setup button creates a local administrator and registers a workstation. Development authentication is disabled when `NODE_ENV=production`.

PostgreSQL uses host port `55432` by default so it does not collide with a conventional local PostgreSQL installation. Override it with `ONEINFO_POSTGRES_PORT` and update `DATABASE_URL` together.

## Run from VS Code

Open **Terminal → Run Task**:

1. Run **Oneinfo: Start local system**.
2. Open `http://127.0.0.1:5173`, register the workstation, and select **Pair NFC device**.
3. For Android, run **Oneinfo: Connect Android NFC** and pair the companion app.
4. For a PC/SC reader, run **Oneinfo: USB NFC reader** and enter the displayed pairing code.

The same commands are available in the integrated terminal:

```bash
npm run android:usb
npm run nfc:desktop -- --pairing 123456
```

Pairing codes expire after five minutes. Write sessions expire after three minutes. The bridge writes an NDEF URI, reads it back, and reports the result to the local API. The workstation independently hashes the expected and returned URLs before completing the NFC job.

### Physical NFC requirements

Real PC/SC writes require a compatible USB reader (the bridge targets ACR122U-compatible readers) and NFC Forum Type 2 tags such as NTAG213, NTAG215, or NTAG216. On Debian/Ubuntu, prepare the reader bridge with:

```bash
sudo apt install pcscd pcsc-tools libpcsclite-dev libccid python3-pip
sudo systemctl enable --now pcscd
python3 -m pip install pyscard
```

The API binds to `127.0.0.1` by default. Do not change `HOST` to a LAN/public interface for the production workstation. Active NFC pairings are intentionally memory-only and must be re-established after an API restart.

### Android phone over USB

1. On the phone, enable Developer options, USB debugging, and NFC.
2. ADB is installed locally in `.tools/android/platform-tools`; no system-wide installation is required.
3. Connect the phone with a data-capable USB cable and accept the USB debugging authorization dialog.
4. Open `apps/android-nfc-bridge` in Android Studio and run the `app` configuration on the connected phone.
5. From VS Code, run **Oneinfo: Connect Android NFC**, or run `npm run android:usb`.
6. Open the production console, select **Pair NFC device**, and enter the displayed six-digit code in the Android app.
7. Claim an NFC job, select **Write and verify NFC**, and hold the NFC card against the phone when prompted.

The USB command creates `adb reverse tcp:3001 tcp:3001`; the phone communicates only with the API on this workstation. Wi-Fi and public deployment are not required.

### Inspect an NFC tag

With the Android bridge paired, select **Read NFC tag** in the production console and hold the tag against the phone. This read-only operation displays the tag UID, technologies, NDEF type, writable state, capacity, message size, parsed URI/text records, raw payload hex, and the complete device result. It does not modify the tag.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

The smoke test requires the API and PostgreSQL to be running. It creates an isolated station and one-card batch, completes QR and NFC work, passes QC, creates and publishes a client profile, assigns and activates the card, and verifies the public profile resolver and event history.

## Repository layout

```text
apps/api                    Fastify API and Drizzle schema
apps/android-nfc-bridge     Native Android USB/NFC companion
apps/control-center         Admin dashboard, profile editor, and public profiles
apps/desktop-nfc-bridge     PC/SC USB reader bridge
apps/production-console     React and Vite production UI
packages/contracts          Shared validation and workflow contracts
scripts/smoke-test.mjs      End-to-end API verification
compose.yaml                Local PostgreSQL service
```

## Production work still required

This is a working foundation, not a production launch. The next milestones are:

1. Integrate Oneinfo's real identity provider and remove reliance on development token issuance.
2. Validate the selected USB NFC reader, NFC tags, printer, card material, and workstation operating system.
3. Package the console with Tauri and add encrypted SQLite offline persistence.
4. Add object storage for QR/SVG/PDF artifacts and configurable print-sheet generation.
5. Add pagination, lease renewal, stale-job recovery, and reconciliation tooling.
6. Publish the OpenAPI contract and generate the production client from it.
7. Add hardware, security, load, backup/restore, and full offline-recovery tests.

Before production, copy `.env.example` to `.env`, replace `JWT_SECRET`, and set the real Oneinfo public-card domain.

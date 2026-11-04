# Oneinfo QR and NFC Production System

See [REVIEW.md](REVIEW.md) for the latest review, fixes, verification, and remaining implementation limits.

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

### One-click startup — Linux, Windows and macOS

One-time setup on each computer:

1. Install Node.js 22.12+ (with npm) and Docker with Docker Compose. On Windows/macOS, start Docker Desktop; on Linux, start Docker Engine or Docker Desktop.
2. Keep the project in a permanent folder. Do not copy `node_modules` or `.tools` between operating systems; dependencies/platform tools are OS-specific.
3. In that project folder, run:

```bash
npm run setup:desktop
```

This creates a **Start Oneinfo** launcher on your Desktop. Double-click it to start the workstation:

| System | Desktop launcher |
| --- | --- |
| Linux | **Start Oneinfo** (`oneinfo-production.desktop`); select **Allow Launching** once if your desktop asks |
| Windows | `Start Oneinfo.cmd` |
| macOS | `Start Oneinfo.command` |

The launcher installs project dependencies on the first run, starts the existing PostgreSQL Docker volume, applies migrations, builds/starts the API and production console, waits for readiness, then opens the console. Chrome/Edge app windows are used when detected, with a default-browser fallback. An already-running Oneinfo API/console is reused without a restart. Repeated clicks do not start duplicate services.

Keep the launcher terminal open. **Ctrl+C** stops only the API/console processes it started; existing services and the PostgreSQL container/data are retained. Closing the browser does not stop the workstation. Startup messages stay in the terminal; service logs are in `.oneinfo/logs/`. Docker must already be running; the launcher does not install Node/Docker or change system privileges.

The launcher also attempts to restore the ADB tunnel for an authorized phone. Install Android Platform Tools for the current OS, or set `ADB_PATH`; use `ANDROID_SERIAL` to choose between different phones. Duplicate USB/wireless aliases of the same phone are recognized. Android debugging authorization and companion-app pairing still happen on the phone. API restarts require app pairing again.

Without a Desktop shortcut, you can use the supplied project launcher (`Start Oneinfo.cmd` on Windows, `Start Oneinfo.command` on macOS, or `Start Oneinfo.sh` in a Linux terminal), the VS Code **Oneinfo: One-click production console** task, or:

```bash
npm run start:local
```

If you move the project or replace the Node installation, rerun `npm run setup:desktop`. This is a local launcher using Node, Docker and an installed browser; it is not a bundled native installer. It starts the production console/API/database; use `npm run dev:control` separately for the admin control center.

For diagnostics, `npm run start:local -- --no-browser --no-adb` skips browser opening and phone setup. Default ports are API `3001` and console `5173`. For isolated instances, set both `PORT` and `ONEINFO_CONSOLE_PORT` to unused ports; database configuration remains in `.env`. Browser app credentials are stored per origin, so a different console port needs workstation registration.

### Manual development startup

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
7. Follow the phone production steps below: scan the printed QR, load NFC, then perform final QC.

The USB command creates `adb reverse tcp:3001 tcp:3001`; the phone communicates only with the API on this workstation. Wi-Fi and public deployment are not required.

Wireless ADB also works after Android wireless-debugging pairing. Use the connected device's current address with `adb -s IP:PORT reverse tcp:3001 tcp:3001` (or the local `.tools/android/platform-tools/adb` binary). Recreate this tunnel after reconnecting. The API remains bound to localhost; the phone uses the ADB tunnel over either USB or Wi-Fi.

### Inspect an NFC tag

With the Android bridge paired, select **Read NFC tag** in the production console and hold the tag against the phone. This read-only operation displays the tag UID, technologies, NDEF type, writable state, capacity, message size, parsed URI/text records, raw payload hex, and the complete device result. It does not modify the tag.

## QR and NFC production workspace

Use `http://127.0.0.1:5173` for the full local workflow:

1. **Create a batch** of 1–1,000 cards, or expand **Use your own links** and paste one unique HTTP(S) URL per line. Pasted links determine the quantity. Generated links use `PUBLIC_CARD_BASE_URL`; configure a real card domain before producing customer cards. Existing card links remain unchanged when the setting changes.
2. Select the batch and choose **Generate all QR codes**, or generate one selected QR. The API creates high-error-correction PNG images and saves the actual image data and SHA-256 checksums in PostgreSQL. Generation is restartable; existing images are retained.
3. Use **Print selected QR** or **Print full batch**. The A4 sheet supports label width/height, column count, gap, and margin in millimetres. Defaults are 55 × 40 mm labels, three columns, 3 mm gaps, and 10 mm margins. Print at 100% / actual size and test a sheet against the physical stock. Browser print settings can override scaling; printer calibration remains a physical check.
4. When the printed cards return, press **1. Scan printed QR** on the phone. Its URL identifies the card and batch automatically, even before NFC has been written. The phone displays the batch, card, and link; the initial print check is saved in card history and appears on the PC.
5. Press **2. Load to NFC** on the phone and hold that card against its NFC reader. The app writes the scanned QR's exact saved link as an NDEF URI and reads it back. The API saves the attempt and updates NFC status without any PC submission. Failed writes can be retried by scanning the printed QR again. A finished card's write job cannot be reused to create an untracked duplicate.
6. Press **3. Scan QR for final QC**, scan the printed QR again, lift the card away, and tap NFC again. Both URLs must match exactly. Only a fresh QR/NFC pair after writing counts toward QC; the first print check and write readback cannot pass final QC. Unknown URLs show an explicit error.
7. Press **4. Approve QC** on the phone after the pair matches. Approval uses the paired operator's current inspector/admin permission and saves the QC record and audit trail. The PC displays print-check status, NFC encoding, final QR/NFC results, and QC approval within two seconds. A mismatch blocks approval.

Run `npm run start:local` or use **Start Oneinfo** for full local startup. `npm run desktop` only opens an already-running console, preferring a Chrome/Edge app window and falling back to the OS browser. `ONEINFO_DESKTOP_URL` selects the URL for that open-only command; `VITE_API_URL` selects the API for manual build/dev startup. The full local launcher builds against its local API. This version has no separate offline sync queue; connecting to a future cloud deployment requires the real API address and authentication integration.

The phone needs the latest companion APK after an app update. PostgreSQL backups now include QR image data and saved scan evidence. Device pairing and in-flight operation sessions remain in memory and must be recreated after an API restart.

## Verification

### General NFC tools and workspace UI

Both apps have **Production**, **NFC tools**, and **Connection / Connect** sections. The PC production view includes batch progress, card/link search, and stage filters. The connection view lists paired phones and their heartbeat status; the phone has NFC hardware status and a shortcut to NFC settings.

In **NFC tools**, either device can start a general tag inspection or write one HTTP(S) website link / plain-text record (up to 2,048 characters, subject to tag capacity). Writing requires explicit replacement confirmation and replaces all existing NDEF records on the tag tapped. The phone checks writable state and capacity before writing and reads back the saved value. Newly formatted tags need a second tap to confirm readback. Neither read nor write utility results change production jobs or QC records; changing a production tag's physical content does not automatically update its production history.

Tag results include UID, technologies, NDEF type, writable state, capacity, message size, parsed records, and raw payloads. Results can be copied and exported as JSON on PC, or copied/shared on the phone. The PC shows up to 20 station operations from the last hour while the API is running, including operations started on the phone. Activity and device pairings are in memory and reset on API restart; general tool operations are not durable production records.

**Stop waiting** cancels a pending tag operation. It does not undo content already written. The phone stops an idle utility task when it sees the cancellation. General operations require the paired phone and the ADB tunnel; standalone/offline tool mode and PC/SC utility writing are not included.

**Erase NFC tag** is available in both NFC tools views. Confirm erasure, then tap only the intended tag. The phone writes an empty NDEF record and verifies it by readback; the API rejects an erase result containing nonempty records or no NDEF readback. Read-only/locked tags cannot be erased. This removes NDEF links/text, leaves the UID unchanged and the tag reusable, and is not a secure wipe of all chip memory. Production records are unchanged. Newly formatted tags require a second tap for readback, just like utility writes.

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

The smoke test requires the API and PostgreSQL to be running. It creates a QA station and one-card batch, completes QR and NFC work, passes QC, publishes a QA profile, assigns and activates the card, and verifies public resolution and audit history. It also checks rejected hash mismatches, duplicate results, reassignment, bridge finalization, and device revocation. These are API regression checks; no physical tag is written. The QA records are retained and the test station is revoked afterward.

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

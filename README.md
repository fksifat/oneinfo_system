# Oneinfo QR and NFC Production System

See [AUDIT.md](AUDIT.md) for the latest audit, verification and remaining limits, and [REVIEW.md](REVIEW.md) for earlier reviews.

For a separate VPS API and PostgreSQL Docker deployment, see [deploy/VPS.md](deploy/VPS.md).
Automated checks, protected-branch releases and the Oneinfo-only deployment/rollback flow are documented in [deploy/CI_CD.md](deploy/CI_CD.md).
The deployed `api.oneinfo.online` server and its maintenance commands are recorded in [deploy/ONEINFO_VPS.md](deploy/ONEINFO_VPS.md).

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
- Client profile editor with photo uploads, publishing, contact information, theme, and social links
- Public mobile-friendly profile pages resolved by profile or card slug
- Assignment workflow that links a QC-passed card to a client and activates it
- PostgreSQL migrations, domain tests, and an end-to-end smoke test

## Deployment boundary

The Production Console and NFC bridge run on the workstation. The Android companion connects directly over encrypted Wi-Fi/LAN, or a PC/SC USB reader can perform encoding. The workstation shares PostgreSQL records with the hosted Admin, storefront and customer profiles; PostgreSQL can be local Docker or the configured cloud database.

Product media uploaded in the control center is stored under the repository's `.product-media` directory by default and served by the API with immutable browser caching. Before publishing uploaded media, deploy the media endpoint on a customer-reachable host and set `PRODUCT_MEDIA_DIR` to persistent storage; the local workstation API binds to `127.0.0.1` and is not publicly reachable. Keep the production workstation private.

## Run locally

Requirements: Node.js 24.x. Docker is needed for a local PostgreSQL database; a configured cloud database does not need Docker.

### One-click startup — Linux, Windows and macOS

One-time setup on each computer:

1. Install Node.js 24.x (with npm). For a local database, install Docker with Docker Compose; start Docker Desktop on Windows/macOS, or Docker Engine/Desktop on Linux.
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

The launcher installs dependencies on first run or after a dependency lockfile update, applies migrations, builds/starts the API, secure LAN listener and production console, waits for readiness, then opens the console. Docker is started only for a local database. Chrome/Edge app windows are used when detected, with a default-browser fallback. An already-running Oneinfo API/console is reused without a restart. Repeated clicks do not start duplicate services.

Keep the launcher terminal open. **Ctrl+C** stops only the API/console processes it started; existing services and the PostgreSQL container/data are retained. Closing the browser does not stop the workstation. Startup messages stay in the terminal; service logs are in `.oneinfo/logs/`. Docker must already be running; the launcher does not install Node/Docker or change system privileges.

The default phone connection uses the console's Wi-Fi pairing QR. ADB is an optional development fallback: use `npm run android:usb`, or launch with `npm run start:local -- --adb`. Install Android Platform Tools for that fallback, or set `ADB_PATH`; use `ANDROID_SERIAL` to select a phone. Saved pairing survives an API restart.

For a private VPS database, set `ONEINFO_DATABASE_SSH=user@host`, `ONEINFO_DATABASE_CONTAINER=oneinfo-vps-postgres-1`, and a `DATABASE_URL` using `127.0.0.1` with a dedicated local port such as `55434`. Authorize this PC's SSH key and verify the server host key first. The launcher resolves that container's private address, opens a loopback-only SSH tunnel, and reconnects after temporary network failures; it skips local Docker startup. It stops its tunnel when closed. PostgreSQL stays unpublished on the VPS. The workstation needs the same `JWT_SECRET` and `PUBLIC_CARD_BASE_URL` as the hosted API. Each PC needs its own authorized key and private `.env`; credentials must not be committed. Windows/macOS require an OpenSSH client available as `ssh`.

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

Keep `HOST=127.0.0.1` for the desktop HTTP API. A second HTTPS listener on port `3443` serves the phone over LAN; `NFC_LAN_PORT` can change that port. Development login rejects non-loopback clients, and LAN pairing requires the secret in the scanned connection QR.

### Android phone over Wi-Fi/LAN

1. Install the updated Oneinfo NFC companion APK on the phone and enable NFC.
2. Connect the phone and production PC to the same Wi-Fi/LAN. Start Oneinfo on the PC.
3. In PC **Connection**, select **Create connection QR**.
4. In phone **Connect**, select **Scan workstation connection QR**, then scan the PC's QR. Its five-minute expiry applies only to new pairing; already paired phones remain paired.
5. Keep the app open while scanning cards. The phone remembers the workstation, retries temporary connection failures and uses network service discovery to find the same PC after address changes. If discovery is blocked, scan a fresh QR to update its address.

Scanning a registered production QR on the paired phone automatically opens Production on that workstation's console, selects its batch/card and clears filters that would hide it. Updates arrive within the next two-second poll after the scan is saved; an active console operation finishes first. Manual selections remain until another phone scan arrives. Print checks and final QC QR scans both select the card; an unknown QR does not change the selection.

The QR carries the PC's HTTPS certificate fingerprint and a one-use pairing secret. The phone verifies that certificate before sending credentials; no system-wide certificate trust change is required. Guest Wi-Fi with client isolation cannot connect phone to PC. Allow the configured HTTPS port (default TCP 3443) through the PC's private-network firewall; UDP 5353 supports automatic discovery.

Pairings, hashed device credentials and recent operation state are saved privately in `.oneinfo/nfc-state.bin`; the workstation certificate/key is in `.oneinfo/lan-identity.json`. Back up and retain both files when updating or restoring this PC. The phone saves pending results and retries delivery without automatically repeating a physical write. Expired operations still expire, and **Remove phone** revokes access. Losing the workstation state/identity requires fresh pairing. The shared Neon database still needs internet; offline production sync is not implemented.

### USB / wireless ADB development fallback

1. On the phone, enable Developer options, USB debugging, and NFC.
2. ADB is installed locally in `.tools/android/platform-tools`; no system-wide installation is required.
3. Connect the phone with a data-capable USB cable and accept the USB debugging authorization dialog.
4. Open `apps/android-nfc-bridge` in Android Studio and run the `app` configuration on the connected phone.
5. From VS Code, run **Oneinfo: Connect Android NFC**, or run `npm run android:usb`.
6. In PC **Connection**, create a connection QR and expand **USB development fallback**. In phone **Connect**, expand **USB development connection** and enter the six-digit development code.
7. Follow the phone production steps below: scan the printed QR, load NFC, then perform final QC.

The USB command creates `adb reverse tcp:3001 tcp:3001`; the phone communicates only with the API on this workstation. Wi-Fi and public deployment are not required.

Wireless ADB also works after Android wireless-debugging pairing. Use the connected device's current address with `adb -s IP:PORT reverse tcp:3001 tcp:3001` (or the local `.tools/android/platform-tools/adb` binary). Recreate this tunnel after reconnecting. The API remains bound to localhost; the phone uses the ADB tunnel over either USB or Wi-Fi.

### Inspect an NFC tag

With the Android bridge paired, select **Read NFC tag** in the production console and hold the tag against the phone. This read-only operation displays the tag UID, technologies, NDEF type, writable state, capacity, message size, parsed URI/text records, raw payload hex, and the complete device result. It does not modify the tag.

## QR and NFC production workspace

The production console and Admin Control Center use the same API/database. In Admin, **NFC & QR operations** embeds the actual console; **Production batches** shows live QR/NFC/QC progress and opens a specific batch in its workspace. Admin data refreshes every five seconds and when the window gains focus. The console refreshes batch lists automatically, clears deleted batch selections, and returns to registration when Admin removes/revokes its station. Use the canonical URLs `http://127.0.0.1:5173` and `http://127.0.0.1:5174` so browser station credentials stay on the same origin. `VITE_PRODUCTION_URL` (Admin build) and `VITE_ADMIN_URL` (console build) can override these links; both applications' `VITE_API_URL` must point to the same API. Tokens are not passed through links or iframes.

Use `http://127.0.0.1:5173` for the full local workflow:

1. **Create a batch** of 1–1,000 cards, or expand **Use your own links** and paste one unique HTTP(S) URL per line. Pasted links determine the quantity. Generated links use `PUBLIC_CARD_BASE_URL`; configure a real card domain before producing customer cards. Existing card links remain unchanged when the setting changes.
2. Select the batch and choose **Generate all QR codes**, or generate one selected QR. The API creates high-error-correction PNG images and saves the actual image data and SHA-256 checksums in PostgreSQL. Generation is restartable; existing images are retained.
3. Use **Print selected QR** or **Print full batch**. The A4 sheet supports label width/height, column count, gap, and margin in millimetres. Defaults are 55 × 40 mm labels, three columns, 3 mm gaps, and 10 mm margins. Print at 100% / actual size and test a sheet against the physical stock. Browser print settings can override scaling; printer calibration remains a physical check.
4. When the printed cards return, press **1. Scan printed QR** on the phone. Its URL identifies the card and batch automatically, even before NFC has been written. The phone displays the batch, card, and link; the initial print check is saved in card history and appears on the PC.
5. Press **2. Load to NFC** on the phone and hold that card against its NFC reader. The app writes the scanned QR's exact saved link as an NDEF URI and reads it back. The API saves the attempt and updates NFC status without any PC submission. Failed writes can be retried by scanning the printed QR again. A finished card's write job cannot be reused to create an untracked duplicate.
6. Press **3. Scan QR for final QC**, scan the printed QR again, lift the card away, and tap NFC again. Both URLs must match exactly. Only a fresh QR/NFC pair after writing counts toward QC; the first print check and write readback cannot pass final QC. Unknown URLs show an explicit error.
7. Press **4. Approve QC** on the phone after the pair matches. Approval uses the paired operator's current inspector/admin permission and saves the QC record and audit trail. The PC displays print-check status, NFC encoding, final QR/NFC results, and QC approval within two seconds. A mismatch blocks approval.

Run `npm run start:local` or use **Start Oneinfo** for full local startup. `npm run desktop` only opens an already-running console, preferring a Chrome/Edge app window and falling back to the OS browser. `ONEINFO_DESKTOP_URL` selects the URL for that open-only command; `VITE_API_URL` selects the API for manual build/dev startup. The full local launcher builds against its local API. This version has no separate offline sync queue; connecting to a future cloud deployment requires the real API address and authentication integration.

The phone needs the latest companion APK after an app update. PostgreSQL backups include QR images and saved scan evidence; back up the workstation's `.oneinfo/nfc-state.bin` and `.oneinfo/lan-identity.json` separately to retain phone pairing and local operation state.

## Verification

### General NFC tools and workspace UI

Both apps have **Production**, **NFC tools**, and **Connection / Connect** sections. The PC production view includes batch progress, card/link search, and stage filters. The connection view lists paired phones and their heartbeat status; the phone has NFC hardware status and a shortcut to NFC settings.

In **NFC tools**, either device can start a general tag inspection or write one HTTP(S) website link / plain-text record (up to 2,048 characters, subject to tag capacity). Writing requires explicit replacement confirmation and replaces all existing NDEF records on the tag tapped. The phone checks writable state and capacity before writing and reads back the saved value. Newly formatted tags need a second tap to confirm readback. Neither read nor write utility results change production jobs or QC records; changing a production tag's physical content does not automatically update its production history.

Tag results include UID, technologies, NDEF type, writable state, capacity, message size, parsed records, and raw payloads. Results can be copied and exported as JSON on PC, or copied/shared on the phone. The PC shows up to 20 recent station operations, including operations started on the phone. Local activity and pairing survive API restarts; general tools do not change production inventory or QC records.

**Stop waiting** cancels a pending tag operation. It does not undo content already written. The phone stops an idle utility task when it sees the cancellation. General operations require a paired phone connected through LAN or the development tunnel; standalone/offline tool mode and PC/SC utility writing are not included.

**Erase NFC tag** is available in both NFC tools views. Confirm erasure, then tap only the intended tag. The phone writes an empty NDEF record and verifies it by readback; the API rejects an erase result containing nonempty records or no NDEF readback. Read-only/locked tags cannot be erased. This removes NDEF links/text, leaves the UID unchanged and the tag reusable, and is not a secure wipe of all chip memory. Production records are unchanged. Newly formatted tags require a second tap for readback, just like utility writes.

```bash
npm run typecheck
npm test
npm run build
npm run smoke
```

The smoke test requires the API and PostgreSQL to be running. It creates a QA station and one-card batch, completes QR and NFC work, passes QC, publishes a QA profile, assigns and activates the card, and verifies public resolution and audit history. It also checks rejected hash mismatches, duplicate results, reassignment, bridge finalization, and device revocation. These are API regression checks; no physical tag is written. The QA records are retained and the test station is revoked afterward.

## Browser UI regression checks

Run `npm run test:ui` with the API (3001), Production Console (5173), Admin (5174), and storefront (5175) running. It builds the apps and uses a separate headless Chrome profile; set `CHROME_PATH` if Chrome is not in its usual location. PostgreSQL credentials must allow creating and dropping a disposable database.

The checks cover responsive pages at 320, 390, 768 and 1440 pixels, navigation, editors, error recovery, batch/print confirmation, NFC tool controls, checkout and customer activation/profile updates. Browser API requests use an isolated fixture database; email and NFC results are mocked. The fixture database is dropped afterward. Screenshots are saved under `.oneinfo/qa/`. These checks do not print physical cards, transfer payment or write/erase a real NFC tag.

## Vercel hosting

The root Vercel project hosts the storefront at `/`, Admin at `/admin`, team portals at `/team`, and customer activation/profiles at `/c/<card-id>`. The backend runs only on the VPS at `https://api.oneinfo.online`. Compatibility requests to Vercel `/api/v1/*` and `/health` proxy to that VPS; no second database-backed Vercel function is deployed. `npm run build:cloud` defaults to the VPS API and password-based Admin sign-in. `.vercelignore` excludes credentials, backups and workstation artifacts.

Keep `DATABASE_URL`, `JWT_SECRET`, SMTP credentials and Admin password settings in the VPS's private `.env.vps`, rather than the frontend build. Vercel needs the public `VITE_API_URL=https://api.oneinfo.online` and `PUBLIC_SITE_URL=https://oneinfo.online`. Hosted development login stays disabled. Admin sessions last 30 minutes; authentication limits are shared through PostgreSQL. Media uploaded through local or hosted Admin goes to the VPS persistent media volume (10 MB per upload). Do not configure the old Blob token on this workstation when using VPS media storage.

The CI/CD deployment backs up the database/media and runs migrations before API cutover; builds alone do not migrate. Migration `0010_unified_production_customer` reconciles the earlier branch histories without resetting records. `npm run test:printed-stock` verifies migrations and workflows, then runs the full QR/NFC smoke flow in a disposable API/database. `npm run smoke` invokes the same safe runner; direct execution against live APIs is refused. Set `TEST_DATABASE_URL` to local PostgreSQL for these tests.

The NFC companion and Production Console stay local, sharing the VPS database through the private SSH tunnel and using its signing secret/card base URL. Keep `HOST=127.0.0.1` for workstation HTTP and development login. `VITE_ADMIN_URL` opens hosted Admin; the launcher overrides the console's API URL to its local NFC API. Hosted APIs do not register local NFC routes. The desktop needs internet for the shared database; offline synchronization is not implemented. Existing QR/NFC links are never rewritten. Configure `PUBLIC_CARD_BASE_URL_ALIASES` with previous owned `/c` domains so old printed stock remains usable for orders, company reservation and card replacement.

In hosted Admin → **NFC & QR operations**, select **Open production console on this PC**. Keep Oneinfo running on that PC. The console opens in its own tab to reuse the browser's registered station and phone connection. A hosted page does not embed the local console: cross-site frames may have separate browser storage or be blocked from the local network. Local Admin pages using the same hostname and protocol can still embed it. If a station code is already registered, use the original browser's standalone console or choose a new code for a new workstation; the existing station is not overwritten.

The authorized Neon-to-VPS consolidation retained old cards, orders, activation secrets and production history alongside existing VPS data. Subsequent workstation changes use the shared VPS database. Email confirmations/review invitations use configured Brevo SMTP or Resend credentials and a verified sender. Email verification and password recovery are not implemented.

## Repository layout

```text
apps/api                    Fastify API and Drizzle schema
apps/android-nfc-bridge     Native Android LAN/NFC companion
apps/control-center         Admin dashboard, profile editor, and public profiles
apps/desktop-nfc-bridge     PC/SC USB reader bridge
apps/production-console     React and Vite production UI
packages/contracts          Shared validation and workflow contracts
scripts/smoke-test.mjs      End-to-end API verification
compose.yaml                Local PostgreSQL service
```

## Client activation, signup and public card profiles

1. Generate a normal Oneinfo QR batch, print/confirm it, write the same link to NFC, and finish phone QC.
2. In Admin → **Cards & inventory**, use **Generate secret code** on a QC-passed card. Copy the code or select **Print private slip** and give that slip to the client with their card. Code generation requires an administrator or inventory manager. The plaintext code is shown once and is never stored; if it is lost, **Replace secret code** invalidates the previous code and unfinished signup grants.
3. On first QR/NFC scan, `/c/<card-id>` asks for the secret code. Validating it opens the signup page for 15 minutes. The client creates an email/password account, enters their public details and links, and selects **Create account & save profile**. Existing account holders can sign in and claim the card using their saved/updated profile.
4. Account creation, profile publication, card ownership and secret consumption are saved in one transaction. Abandoning signup does not consume the code; submitting it successfully makes it unusable for another claim. Order reservation and QC do not activate or publish a client identity.
5. Later QR/NFC scans show the owner's public profile. **Manage this card** lets its owner sign in and update their profile. Account email/password are private; only explicitly entered public contact details are displayed. Customer and operator authentication use separate token audiences.
6. Visitors can use **Share my contact** with their consent to save a name and email/phone in the owner's private inbox. The owner opens **Manage this card → Shared contacts → Open inbox** to read them. Sharing does not send an email or SMS notification. Shared contacts are never shown on the public profile.

Use **Upload photo** during signup or under **Manage this card → Public profile** to choose a JPEG, PNG or WebP (up to 10 MB). Photos are centre-cropped to a square and resized to at most 640px before uploading to the existing persistent media storage. Select **Save profile** to publish the photo, or **Remove photo** and save to return to initials. Admin profile editors also support uploads. Customer uploads require a signed-in account or a current activation grant, accept raster images up to 2 MB, and allow 30 attempts per account/card per hour. Removing a photo detaches it from the profile; stored media is retained with the existing media backups.

For local testing, generated URLs default to `http://127.0.0.1:5174/c`; run `npm run dev:control` along with the local API/console. The launcher's ADB connection and `npm run android:usb` forward ports 3001 and 5174 for a connected test phone. These loopback URLs work only on the workstation or a phone with the tunnel; before printing real client cards, set `PUBLIC_CARD_BASE_URL` to your hosted HTTPS customer site ending in `/c`, set its `VITE_API_URL`/API CORS origins, and serve SPA fallbacks for `/c/*`. Existing printed links remain unchanged; keep their domain/routing alive. This change does not deploy the customer site or alter existing saved QR links.

Activation codes are 80-bit random values stored only as card-bound SHA-256 hashes; passwords use salted scrypt. Public authentication and checkout limits use PostgreSQL transaction locks. Customer sessions last eight hours; activation grants last 15 minutes and code rotation invalidates them. Email verification and password recovery are not included. External/custom QR links keep their own destination and are not allocated as claimable stock unless their exact previous owned base URL is explicitly configured as an alias.

## Production work still required

Printed QR stock and orders: in Production Console, generate and print a full batch, then tick the printing-complete checkbox and select **Confirm printed batch**. Only confirmed batches appear in Admin stock. Each ordered unit receives one unique managed Oneinfo QR, reserved automatically from the shared QR pool. An order with insufficient stock stays **Awaiting QR** (or partially assigned); confirming another batch fills pending quantities in order of receipt. Admin Orders shows assigned links and refreshes every five seconds. Allocation reserves a physical card without creating a client profile or publishing order contact data. Client ownership is established by secret-code signup, as described above. Assignment does not bypass NFC encoding or final phone QC. Production batches currently track generic QR stock, so allocation does not match catalog finishes/materials.

Run `npm run test:printed-stock` for database-backed workflow checks. It creates, migrates and drops a disposable test database using the configured PostgreSQL server, with outbound confirmation emails mocked. The configured database is not populated or cleared by these tests.

This is a working foundation, not a production launch. The next milestones are:

1. Integrate Oneinfo's real identity provider and remove reliance on development token issuance.
2. Validate the selected USB NFC reader, NFC tags, printer, card material, and workstation operating system.
3. Package the console with Tauri and add encrypted SQLite offline persistence.
4. Add object storage for QR/SVG/PDF artifacts and configurable print-sheet generation.
5. Add pagination, lease renewal, stale-job recovery, and reconciliation tooling.
6. Publish the OpenAPI contract and generate the production client from it.
7. Add hardware, security, load, backup/restore, and full offline-recovery tests.

Before production, copy `.env.example` to `.env`, replace `JWT_SECRET`, and set the real Oneinfo public-card domain.

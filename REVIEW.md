# Project review — 3 November 2026

Reviewed the API routes and database schema, shared contracts, production console, admin/profile interface, Android companion, PC/SC writer, storefront JavaScript, smoke workflow, and local startup configuration. Applied Ponytail's smallest-complete-change approach; no new runtime dependencies or simulator were added.

## Corrected findings

| Priority | Finding | Correction |
| --- | --- | --- |
| High | NFC success accepted arbitrary or mismatched hashes. | Validate expected/read-back equality and compare the expected hash against the stored canonical URL. |
| High | Completed jobs accepted fresh result submissions and concurrent results could overwrite workflow state. | Guard transitions inside transactions with `CLAIMED` status and station ownership; roll back rejected submissions. Scope result replays to the original job. |
| High | A paired phone remained authorized after its station was revoked. | Validate station status for device requests; invalidate revoked tokens. Station revocation and its audit entry now commit together. |
| High | Device callbacks could overwrite finalized results or report expired tasks; overlapping operations could target one station. | Enforce session expiry, immutable finalized results, and one active read/write operation per station. |
| High | Cards could be reassigned to another profile, including through a concurrent request. | Activate only an unassigned, QC-passed card with a conditional transactional update. Only activated cards resolve through the public card API. |
| High | User-supplied URLs accepted executable schemes; scanned URI records were rendered as arbitrary links. | Restrict profile links/images/websites to HTTP(S); display other scanned schemes as text. |
| Medium | Public profile/card responses and station lists exposed internal ownership/production/credential fields. | Select public fields explicitly and omit station credential hashes from responses. |
| Medium | Expired authentication broke NFC polling and the admin interface. | Renew development tokens in each client's shared API code, serialize concurrent renewals, and reuse renewed credentials. |
| Medium | Android tasks could remain active after expiry, be processed twice, or lose their result on a transient USB failure. | Add task deadlines, atomic scan exclusion, result delivery retries, connection cleanup, and executor cleanup. Rejected/expired submissions release the task. |
| Medium | Formatted tags were marked failed without an opportunity to verify; UTF-16 NDEF text was decoded as UTF-8. | Request a second tap after formatting; honor the text record encoding flag. |
| Medium | PC/SC writer wrote before checking tag format, capacity, or access. | Validate the Type 2 capability container before writing; reject oversized or malformed NDEF messages and read back in bounded chunks. |
| Medium | Saved storefront cart values could inject HTML or override catalog prices. | Validate saved cart entries and restore prices from the current catalog. |
| Medium | PostgreSQL was bound to all interfaces despite the local-only requirement. | Rebind Docker PostgreSQL to `127.0.0.1`, retaining the existing data volume. |
| Medium | Startup/tests could use stale compiled contracts; `.env` configuration was not loaded consistently. | Build contracts before API startup/tests, load the root `.env` through Node, and share validated database configuration with migrations. |
| Low | Resuming a claimed job returned no card; duplicate identifiers returned generic server errors. | Return the complete job/card on resume; report duplicate identifiers as 409 and malformed database identifiers as 400. |
| Low | Active station/pending job counts were inaccurate. | Count active stations and queued, claimed, and retryable jobs. |
| Low | “Save contact details” opened email instead of saving a contact. | Download an escaped vCard file. |
| Low | Storefront forms stayed hidden after reopening; keyboard focus could escape open overlays. | Reset form visibility on reopen and wrap keyboard navigation within the active overlay. |

## Verification

- TypeScript checks and web/API builds.
- Eight API/client validation tests, three Python writer checks, and two storefront regression checks.
- Extended API smoke workflow: QR/NFC/QC, profile publication and activation, hash mismatch rejection, duplicate result rejection, complete claim replay, public field filtering, bridge result finalization, and station revocation.
- Database migrations against the retained local PostgreSQL volume; localhost-only port verified.
- Android debug APK compiled, installed on the Samsung SM-A166E, launched, and paired over the restored USB tunnel. NFC was enabled. Physical tag scan/write behavior was not retested during this review.
- Production dependency audit: no reported vulnerabilities. Full audit still reports four moderate development-tool advisories through Drizzle Kit's legacy esbuild dependencies. The proposed audit fix is an incompatible Drizzle Kit downgrade; it was not applied.

## Remaining limits

1. The selling website saves order drafts locally; it has no real order submission, payments, or fulfillment integration. Its local source was updated; the hosted copy was not redeployed.
2. The configured card domain still defaults to `cards.oneinfo.example`. A real public card domain and routing/hosting connection are required for customer taps outside the workstation.
3. Superseded by the production-workspace update: actual PNG data now persists in PostgreSQL, with single/full-batch A4 print layouts and PNG downloads. Physical printer calibration still requires a test sheet.
4. NFC pairings and inspection results live in API memory. Restarting the API requires pairing again; a page reload does not restore the previous inspection. Offline task/result recovery across application restarts is not implemented.
5. Job leases are stored but are not automatically renewed or recovered across stations. The same station can resume a claimed job; abandoned/revoked-station jobs still need administrative recovery tooling.
6. Authentication remains a local development administrator flow. The client profile editor is admin-managed; customer self-service login is not implemented. These services must remain bound to localhost.
7. Android supports tag inspection. The optional PC/SC bridge targets Type 2 NDEF writing and is not a universal card reader. Its changes have parser/validation tests but were not tested against a physical USB reader.
8. Lists are capped rather than paginated; batch status is not rolled up from all its jobs. Hardware capacity, larger batches, and failure recovery need additional acceptance testing before relying on the tool for volume production.

Automated smoke checks create clearly labeled QA batches/profiles and revoke their own test stations. They do not modify existing client profiles or write physical tags.

## Production workspace follow-up

The console now supports batch creation with generated URLs or imported unique links, saved PNG QR images, individual/full-batch A4 label printing, selecting a QR's saved URL for NFC writing, and independent phone camera/NFC verification. PostgreSQL stores PNG data, verification evidence, and matching/mismatching card events. QC requires both latest scan methods to match.

The extended smoke check covers bulk PNG persistence, repeated generation without duplication, custom links, mismatched scans, and the QC verification gate. Automated checks now comprise 10 API/client tests, 3 PC/SC writer tests, and 2 storefront tests.

Verification control was subsequently moved to the Android app: the paired phone loads produced cards and starts its own camera/NFC verification sessions. The PC has no scan-start controls and polls a compact status endpoint every two seconds. Device authorization, matching evidence, and QC regression checks pass through the phone-initiated API. The new APK was installed and paired; its card selector and both buttons were visually checked. Physical scans were not repeated after this control-only change.

On the connected Samsung SM-A166E, the updated Android companion was installed and paired. Its initial camera launch exposed a missing AndroidX runtime dependency; that dependency was added and the corrected APK reinstalled. A real camera scan and an independent NFC scan of card `CkLJbRnlc_oq` both matched the stored URL. The console showed both checks passing and enabled QC. The tag was not rewritten during this follow-up. A print preview was opened and cancelled; physical printing and stock calibration were not performed.

Verification now starts directly from a phone QR scan, with no card list or manual loading. The scanned URL identifies the production card, records camera evidence, and automatically arms NFC reading for the same URL. The dashboard receives the comparison result through its existing polling. The scan-first API smoke check covers matching and mismatching NFC links, unknown QR links, repeated scan requests, and the QC gate. TypeScript checks, all 15 tests, web/API builds, Android debug assembly, and the extended smoke workflow passed. The new APK was installed; this combined scan-first sequence still needs a physical QR/NFC acceptance scan.

## Print-to-card workflow — 2026-11-04

The previous scan-first sequence is superseded by four phone actions: Scan printed QR, Load to NFC, Scan QR for final QC, and Approve QC. The first scan resolves the exact URL to its batch/card before NFC is written and records PRINT_QR_CHECKED. Load to NFC claims that card's existing NFC job and saves write/readback evidence directly through the API. Final QC requires a fresh QR/NFC pair after the last successful write, with matching scan IDs; earlier scans and write readback cannot satisfy it. Approval uses the paired operator's current active inspector/admin permission, persists QC and audit records, and updates saleable inventory. The PC displays these statuses through polling; NFC loading and QC approval are controlled from the phone.

The phone and PC share the current project API. `npm run desktop` opens a separate Chrome app window; a native installer, offline synchronization, and external cloud deployment are not included. The current API can later be hosted with real authentication, and the console already supports VITE_API_URL.

Automated verification includes 11 API/client tests, 3 PC/SC checks, 2 storefront checks, web/API builds, Android assembly, and extended API smoke tests for print recognition before NFC, write failure/retry, write-result replay, automatic persistence, mismatches, stale-scan rejection, phone QC approval/replay, and saleable inventory. Real physical printing and the new complete phone sequence require acceptance testing.

## Shared NFC toolbox and UI — 2026-11-04

PC and Android now separate production, general NFC tools, and connection setup. The PC adds batch progress, search, stage filters, connected-device status, shared activity, readable tag details, JSON export, and copying. Android has matching navigation, hardware/settings status, local tag details, copy/share, and utility cancellation. Device heartbeats continue during production tasks so an idle camera/NFC wait does not falsely show the phone offline.

Either device can request a general inspection or one URL/text NDEF write with explicit overwrite consent. The phone checks tag access/capacity, reads back the written record, and reports errors. The API independently compares decoded utility readback, rejects changed result replays, and scopes task/results/cancellation to the paired station/device. Utility operations do not change card/job/QC records. Recent utility sessions are retained in memory for one hour (latest 20 displayed), including cancelled/failed tasks; restarts clear them.

Validation now includes 12 API/client tests, 3 PC/SC checks, 2 storefront tests, web/API/Android builds, and smoke checks for utility consent, unsafe URLs, Unicode text preservation, URL readback mismatch, result replay, cancellation, production isolation, and the existing print/NFC/QC workflow. Physical general-purpose writes and printer calibration require hardware acceptance checks. PC visual inspection could not run because the browser control connection failed; Android navigation/layout was inspected on the connected Samsung.

The NFC toolbox also supports ERASE from phone or PC with explicit confirmation. It writes a TNF_EMPTY NDEF record, checks writable state/capacity, verifies the empty readback, and retains the normal result/retry/cancellation handling. UID and production records remain unchanged. This clears NDEF content and is not a secure chip-memory wipe. Added contract and smoke checks cover missing consent, nonempty/unformatted erase readbacks, valid empty records, and immutable result replay. No physical tag was erased during development.

## Cross-platform local launchers — 2026-11-04

`npm run setup:desktop` creates a platform-specific Start Oneinfo desktop shortcut using the installed Node executable and project path. Project-level Windows CMD, macOS command, and Linux shell launchers are also included. `npm run start:local` installs missing project dependencies, starts PostgreSQL with Compose, builds/migrates missing services, waits for Oneinfo-specific health/HTML readiness, and opens a browser/app window. Existing services are reused. A PID lock prevents duplicate starts, and owned API/console processes stop on launcher shutdown; existing services and database data are retained. Optional ADB tunnel setup recognizes duplicate transports of the same physical phone and supports explicit device selection.

Six launcher checks cover readiness/conflicting servers, startup child failures, Windows command construction, paths with spaces/shell characters, platform shortcut generation, managed-file protection, and browser fallbacks. The generated Linux desktop entry passed desktop-file-validate. A real Linux cold-start check on isolated API/console ports verified migration, both services, repeat-launch reuse, shutdown of owned services, and continued availability of the pre-existing workstation. Windows/macOS command paths were tested from Linux; actual execution on those operating systems remains unverified. Node.js 22.12+, Docker with Compose, and a browser are still required; this is not a bundled installer.

## Main pull integration — 2026-11-04

Fast-forwarded main from ba2e31b to 0b5e952 (four upstream storefront/catalog/checkout commits). Local work was saved in stash 73191d263883c65706d0198dbb295ca99cf40e4b and restored. Conflicts were reconciled to retain both upstream storefront functionality and local NFC/launcher changes. The nested sites/oneinfo-storefront repository was left unchanged.

Both branches had a migration numbered 0002. The local QR/NFC schema addition is now migration 0008_qr_nfc_verification with a regenerated combined snapshot; its SQL tolerates already-existing QR/NFC tables. The original local 0002 SQL/snapshot are retained in the stash and .oneinfo/pull-backup-73191d2/. No database migrations were applied during this pull.

Read-only inspection found that this workstation's database contains only migrations 0000, 0001, and the old local QR/NFC 0002 (timestamp 1793716108642). Upstream's products migration 0002 has an earlier timestamp (1793715683079), so a normal timestamp-based migration run would skip it even though the products table is absent, then fail on later product alterations. Reconcile that legacy migration history and apply the missing products migration before running the new migration chain against this existing database. Fresh databases do not have this legacy-history issue. Storefront products/orders features require those database updates; they were not runtime-tested during the pull.

Before publishing the local changes on `sifat`, the legacy `sites/oneinfo-storefront` Git link was converted to ordinary source-controlled static files. It had no remote or submodule mapping, so fresh clones could not retrieve the source used by two regression checks. Its original Git metadata was moved to `.oneinfo/git-backups/legacy-storefront-git/`; the source changes and hosting metadata are preserved. The active managed storefront remains `sites/storefront`.

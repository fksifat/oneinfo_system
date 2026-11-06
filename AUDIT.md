# Full project audit — 6 November 2026

Scope: storefront, Admin/client/team interfaces, authentication, order/payment
validation, QR stock and activation, local Android/PC-SC NFC paths, media storage,
private workstation connectivity, dependencies and the production deployment.
Synthetic business writes ran only in disposable fixtures. Production orders,
ownership and activation secrets were preserved; public page visits may record
ordinary view analytics. No synthetic customer messages, payments or tag writes
were sent.

## Findings and fixes

| Finding | Change and evidence |
|---|---|
| Database outages became HTTP 401, forcing valid users to sign in again | Verify token claims separately from database lookups; regressions cover operator/customer outages and malformed UUIDs. |
| SQL exceptions could log query parameters containing private customer data | Error logs retain only error name/code/status; a regression verifies private parameters stay out of logs. |
| Some private API responses had no explicit cache policy | Default API responses to `no-store`; explicit public media caching remains intact. |
| Old owned QR domains were excluded after the domain migration | Add validated, explicit card-base aliases shared by stock allocation, replacement and company reservation. Tests verify unchanged links and reject unconfigured hosts. |
| Legacy profile assignment could claim an order's reserved card | Require confirmed, unreserved stock; retain customer/company activation guards and mark manual assignments RESERVED. Integration tests cover rejection and idempotency. |
| Public checkout had no creation-attempt limit | Apply shared PostgreSQL limits while allowing exact retries to retrieve an existing order receipt. |
| Vercel could still deploy a second API against the old database | Remove its serverless adapter; proxy compatibility API paths to the single VPS backend and make the cloud build default explicit. |
| Manual smoke tests could write to a running workstation API | Run all smoke operations against a disposable database/API, with a per-run nonce guard before requesting credentials. Added to the existing integration runner and CI. |
| Deployment rollback used a stale root Compose file | Select the previous successful release's Compose file along with its pinned image; regression exercises this path. |
| Compressed release size did not bound extracted disk usage on the shared VPS | Reject oversized expansion/entry count before extraction; a sparse-file archive regression proves no oversized file is extracted. |
| CI runner drift and production dependency regressions could surprise releases | Pin Ubuntu 24.04 and add a production dependency audit gate. |

## Verification

- Unit/type/build checks and disposable PostgreSQL migration/workflow tests.
- Full QR/NFC smoke flow, including write/readback, QR/NFC mismatch, erase,
  Unicode text, cancellation, retries and station revocation, with fake tags.
- Real Chrome responsive flows at 320/390/768/1440px: Admin, storefront checkout,
  production/printing, activation/signup/editing, contact sharing/private inbox.
- Extended browser coverage for company administration, customer workspace,
  CSV import, employee edit links, branding and public directory/profile privacy.
- Deployment success/failure regressions, archive guards and smoke safety guards.
- An actual VPS CI database backup restored into a disposable local PostgreSQL
  database. Tables/data and foreign keys validated; the restored database was
  then dropped. Production records were not restored over or modified.

## Remaining limits

The installed migration-tool chain has four moderate npm advisory entries
stemming from its old esbuild dependency. Production dependencies have no known
npm vulnerabilities. npm's suggested fix is a breaking Drizzle downgrade; it
was not applied. No ineffective dependency override is kept.

Physical NFC/printer/payment-provider tests and Windows/macOS runtime checks were
not performed. CI backups remain on the same VPS; scheduled off-server backups
and retention policy are not configured. Email verification/recovery and full
offline production synchronization remain product features outside this repair.

This audit records exercised paths and observed defects; it does not assert that
every possible input, device or concurrent production scenario is defect-free.

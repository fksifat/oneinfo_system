# Full project audit — 13 November 2026

Pulled `origin/main` through `a4c80ed` before review. Preserved local editor settings and existing customer, card, order and media data. Reviewed storefront checkout/customization/invoices, Admin and customer/company profiles, authentication, activation and QR/NFC production, local backups, dependencies, migrations and deployment safeguards.

## Confirmed findings

| Priority | Problem | Fix and evidence |
|---|---|---|
| P1 | Public profile preview accepted any operator token, allowing production-only roles to read unpublished profiles despite the private profile API's reader-role restrictions. | Limit optional preview authentication to SUPER_ADMIN/AUDITOR; a production-operator token receives only normal public visibility. Integration checks private handle and slug routes with anonymous, writer and administrator access. |
| P1 | Recent changes weakened QC/print checks with OR conditions and activation-only bypasses. A failed-QC or unconfirmed active card could show a profile through one alias while contact/vCard routes rejected it. | Restore the common publication, active owner/employee, QC-passed and print-confirmed predicate across named profiles, card scans, vCards, QR badges and contact sharing. Regressions cover failed/pending QC and missing print confirmation. A read-only live aggregate found zero active cards with inconsistent QC/print flags; no data repair was needed. |
| P2 | Employee QR badges used the request Origin as their destination and ignored profile/account visibility. Direct downloads could lead to the wrong portal; caller-controlled origins could change the encoded link. | Derive destinations from the employee's registered company domain or the configured public card origin/handle, and apply the shared public visibility guard. PNG decoding tests verify both canonical and branded destinations despite an unrelated supplied Origin. |
| P2 | Optional operator authentication swallowed database failures along with invalid credentials. | Only authentication/role rejection falls back to anonymous access; infrastructure failures propagate to the normal error handler. Auth-outage regression verifies the error is preserved. |

Company suspension/reassignment was also checked: disabling an employee intentionally suspends their cards, and assigning that card to a different active employee is a supported handover. That behavior was retained and its existing workflow regression passes.

## Verification and remaining limits

- Typecheck and full build pass; 129 API unit checks, desktop bridge tests and 32 launcher/storefront/hosting checks pass.
- 69 disposable PostgreSQL workflows plus guarded QR/NFC smoke pass, including stock deletion protection, activation, payment/packing/invoice privacy, customer contact sharing, company handover and database backup access.
- Chrome checks pass at 320/390/768/1440px across Admin, storefront, production/print/backup screens, profile activation/editing/photo upload, contact exchange and company management. No synthetic payments, emails or tag writes were sent to live services.
- Android unit/debug APK build and deployment/rollback/archive safeguards pass. Drizzle migration generation was checked in an ignored temporary directory; fresh migrations and reconciliation run only against disposable databases.
- Production dependency audit: **0 vulnerabilities**. **4 moderate development-only audit entries remain** in the old esbuild branch of Drizzle's loader (one underlying advisory). npm's proposed automatic fix downgrades Drizzle across a breaking version boundary; no unvalidated dependency override or forced downgrade was committed. Keep migration/development tooling private while awaiting a compatible upstream update.
- Physical printer/NFC/camera hardware, other desktop operating systems, provider delivery and a full VPS disaster recovery were not exercised in this audit. Database restore was separately verified when the local backup feature was introduced; current backups remain intact.

No application schema migration or customer-data rewrite is required by these fixes. Historical audit results follow below.

---

# Production management follow-up — 9 November 2026

Reviewed Admin inventory/assigned cards, batch visibility and reprinting, workstation launch/connection guidance, station revocation/recovery, and list refresh/pagination. Changes preserve existing assignment, print-confirmation, deletion and activation guards; no business data migration is required.

- Inventory/assigned search and stock filters run before cursor pagination, including managed QR-link normalization. Cards retain clear NFC/QC/order-slip next actions. Existing legacy code management is collapsed; fresh stock no longer offers a competing per-card code workflow.
- Admin can list awaiting-print batches explicitly without exposing unconfirmed cards as available stock. Reprinting stays print-confirmation protected and adds bulk selection.
- Stations show searchable connection states and unfinished-job counts, including queued work. Recovery says that it revokes access; idle stations do not offer a redundant recovery action. Malformed revoke IDs return validation errors.
- Removed duplicated production metrics/setup cards and restricted polling to the current list plus the common summary. Existing local-console credential isolation is unchanged.

Validation uses disposable database/API/browser fixtures. No live orders, card ownership, activation codes or NFC contents are changed by the audit. Physical printing and phone/tag hardware remain an operator check.

---

# Full project audit — 8 November 2026

Scope: storefront, Admin/client/team interfaces, authentication, order/payment
validation, QR stock and activation, local Android/PC-SC NFC paths, media storage,
private workstation connectivity, dependencies and the production deployment.
Synthetic business writes ran only in disposable fixtures. Production orders,
ownership and activation secrets were preserved; public page visits may record
ordinary view analytics. No synthetic customer messages, payments or tag writes
were sent.

## Current findings and fixes

| Finding | Change and evidence |
|---|---|
| Profile/vCard aliases could expose suspended, retired or replaced profiles, or profiles belonging to disabled accounts | Share one visibility predicate across handles, legacy profile URLs, contact downloads, card scans and company directories. Tests cover primary/secondary customer profiles, inactive owners/employees and per-card QC/print eligibility. Profiles with another eligible active card remain accessible. |
| Manual Admin assignment could attach customer/company-owned profiles without transferring account ownership correctly | Keep manual assignment for operator-managed profiles; require the existing customer/company activation flow for owned and order-created profiles. Integration regression verifies the rejection. |
| Replacing a suspended card silently activated its replacement | Preserve SUSPENDED status and record the matching replacement event; serialize replacement with stock allocation/deletion. |
| Large batch creation made four database writes per card across the workstation/VPS tunnel | Bulk insert cards, jobs and creation events in the existing transaction (five writes per batch). Measured shared database round trip was about 58ms; a 1,000-card fixture verifies all 3,000 jobs and 1,000 creation events. |
| Password changes and reset-link invalidation were separate writes; concurrent reset links locked tokens in opposite order | Perform password/session changes and reset invalidation atomically, serializing account-link completion and password changes by account email before locking reset tokens. Concurrent reset and stale-link regressions pass. |

These fixes require no database migration or new dependency. Existing order codes, ownership, QR URLs and customer data are retained.

## Earlier fixes retained (6 November)


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

- Full typecheck, build and unit checks: 94 API unit tests; desktop writer and launcher/storefront/hosting checks.
- 59 disposable PostgreSQL workflow tests, including the new order-per-card temporary profile/code flow, activation concurrency, public access revocation and password reset races.
- Android unit tests and debug APK assembly using Gradle 8.9; deployment/rollback regression tests pass.
- Production npm dependency audit: zero known vulnerabilities. Four moderate entries remain in the development-only Drizzle/esbuild migration tool chain.
- Full QR/NFC smoke flow, including write/readback, QR/NFC mismatch, erase,
  Unicode text, cancellation, retries and station revocation, with fake tags.
- Real Chrome responsive flows at 320/390/768/1440px: Admin, storefront checkout,
  production/printing, activation/signup/editing, contact sharing/private inbox.
- Extended browser coverage for company administration, customer workspace,
  CSV import, employee edit links, branding and public directory/profile privacy.
- Deployment success/failure regressions, archive guards and smoke safety guards.
- Earlier evidence (6 November): an actual VPS CI database backup restored into a disposable local PostgreSQL
  database. Tables/data and foreign keys validated; the restored database was
  then dropped. Production records were not restored over or modified.

## Live service checks

Both frontend domains and VPS API health returned HTTP 200. Anonymous Admin/order requests were rejected with 401. Public workstation NFC and development-login endpoints returned 404. The dedicated API and PostgreSQL containers were healthy; API restart count was zero, certificate-renewal timer active, and database backup files were present. These are read-only operational checks, not a live customer purchase or activation test.

Local shared-mode Admin/storefront use the configured cloud API so profile/product media stay on customer-reachable storage; the private workstation API remains the NFC bridge. Browser regression requests are intercepted into disposable fixtures.

## Remaining limits

The installed migration-tool chain has four moderate npm advisory entries
stemming from its old esbuild dependency. Production dependencies have no known
npm vulnerabilities. npm's suggested fix is a breaking Drizzle downgrade; it
was not applied. No ineffective dependency override is kept.

Physical NFC/PC-SC reader/printer/payment-provider tests and Windows/macOS runtime checks were not performed. Deployment backups observed here remain on the same VPS; off-server backup recovery was not validated. Email verification, recovery and company invitations are now covered with mocked email delivery; live mailbox delivery was not exercised. Full offline production synchronization remains outside this repair. The desktop PC/SC helper supports production Type 2 URI encoding; general NFC tools are exercised through the Android bridge fixture.

This audit records exercised paths and observed defects; it does not assert that
every possible input, device or concurrent production scenario is defect-free.

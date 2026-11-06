# Deployed Oneinfo VPS — 5 November 2026

API: **https://api.oneinfo.online** (`/health` for process health,
`/api/v1/products/public` for the public, database-backed catalog).

## Server and containers

- VPS: `187.53.134.195`; deployment directory: `/opt/oneinfo`.
- Compose project: `oneinfo-vps`; independent API and PostgreSQL 17 containers.
- Database volume: `oneinfo-vps_postgres-data`; uploads: `oneinfo-vps_product-media`.
- API bindings: `127.0.0.1:3301` and `172.18.0.1:3301`. The second address is the
  existing Nginx Docker bridge gateway. Neither binding is the public VPS IP.
- PostgreSQL has no published port. Oneinfo does not join AriseSell networks.
- Environment/secrets: `/opt/oneinfo/.env.vps`, mode 600. Do not commit this file.
- Admin email: `admin@oneinfo.online`. The generated password is in the ignored
  local `.oneinfo/deploy/vps-admin-credentials.txt` file, not in this document.

Always include the Docker proxy override for this server. Dropping it removes
the bridge binding used by Nginx:

```bash
cd /opt/oneinfo
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml ps
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml logs --tail=100 api postgres
```

To update, copy the reviewed backend source, back up the database/media, build
both images, run migrations successfully, then recreate the API:

```bash
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml build api migrate
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml run --rm migrate
# Only after a successful migration:
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml up -d --wait api
```

Never use `down -v`: it deletes the database and upload volumes. Changing only
the PostgreSQL password in the environment does not rotate its stored password.

## Order confirmation email

Set these three values in `/opt/oneinfo/.env.vps`. The SMTP login comes from the
Brevo SMTP settings page. Use the full SMTP key.

```dotenv
BREVO_SMTP_USER=your-login@smtp-brevo.com
BREVO_SMTP_KEY=your-full-smtp-key
ORDER_EMAIL_FROM="Oneinfo <no-reply@oneinfo.online>"
```

The API connects to `smtp-relay.brevo.com:587` with required STARTTLS. After
updating the environment, recreate the API container from `/opt/oneinfo`:

```bash
docker compose --env-file .env.vps -f compose.vps.yaml -f deploy/compose.docker-proxy.yaml up -d --no-deps --no-build --wait api
```

The checkout settings endpoint `/api/v1/orders/shipping` reports whether order
confirmation email is configured. Brevo Logs shows acceptance and delivery.
Each new order gets one SMTP send attempt after it is saved. A failed attempt
leaves the order in the database and shows the order ID at checkout.
Admin payment verification sends the verified amount and any remaining balance.
Marking an order delivered sends a delivery confirmation with the private review
link. Set `STOREFRONT_URL` to the public storefront for that link. The delivery
action can retry a failed invitation.

Order tracking links use `JWT_SECRET` to sign a private link and `STOREFRONT_URL`
for links in email. Keep both production values stable between releases. Admin
Orders shows recent send attempts and can retry failures. An accepted send means
the mail service accepted the message for delivery.

Lead forwarding is optional. Set `CRM_LEAD_WEBHOOK_URL` to a trusted HTTPS
receiver and, if required, set `CRM_LEAD_WEBHOOK_TOKEN`. The receiver gets a POST
with the lead ID as its `Idempotency-Key`. Visitors choose whether the card owner
can forward their details. The card owner must initiate the send from the inbox.

For a branded company portal, attach the customer's hostname to the frontend
hosting project and verify its DNS and HTTPS there. In Admin → Companies, save
that hostname on the workspace. The public portal opens at `/team` on the
customer hostname. Company owners sign in at `/team?manage=1` on Oneinfo.

## Shared Nginx and HTTPS

The existing `arisesell-nginx` owns public ports 80/443. Its configuration includes
`/etc/nginx/certs/extra-sites/*.conf` through the existing root-managed certificates
mount. Oneinfo's active virtual host is stored on the host at:

`/opt/arise-sell/backend/certs/extra-sites/oneinfo.conf`

Its source template is `deploy/nginx-api.conf`. HTTP serves ACME challenges and
redirects other traffic to HTTPS. The public proxy blocks the workstation-only
`/api/v1/local-nfc` and development routes. Forwarded client addresses are replaced
by Nginx; the API trusts exactly one proxy hop.

The optional main-config include was merged in
[AriseSell PR #16](https://github.com/arisesellofficial/arise-sell/pull/16).
Oneinfo health and catalog passed after AriseSell deployed that merge.

Let's Encrypt certificate files and ACME webroot are beneath:

`/opt/arise-sell/backend/certs/oneinfo/`

The initial certificate expires on **3 February 2027**. The enabled
`oneinfo-certbot.timer` checks twice daily, with a randomized delay; its service
renews through Certbot 5.9.0 and validates/reloads Nginx afterward.

```bash
systemctl list-timers oneinfo-certbot.timer
systemctl status oneinfo-certbot.service
journalctl -u oneinfo-certbot.service --since '7 days ago'
```

The Certbot renewal dry-run and the actual systemd service both passed.

## Database and backup

This is a new database. All 11 migrations applied. It starts with the two catalog
products seeded by migrations, one configured Admin account after login, and no
customer profiles, cards or orders. Existing Neon/workstation data was not copied.

An initial PostgreSQL custom-format dump is saved at:

`/opt/oneinfo/backups/initial-20261105.dump`

The archive is nonempty and `pg_restore --list` passed. This is not a full restore
test or an off-server backup. Regular database/media backups are not scheduled;
use the commands in `deploy/VPS.md` and keep encrypted copies outside this VPS.

The shared Nginx configuration before this deployment is also backed up at:

`/opt/oneinfo/backups/arisesell-nginx-before-oneinfo.conf`

## Frontend connection still required

At deployment time, `oneinfo.online` serves a Hostinger parked page. The existing
application is at `https://oneinfo-system.vercel.app`. The locally authenticated
Vercel account could not access that project, so its frontend was not redeployed
and still uses its existing API/database.

To switch that Vercel frontend to the VPS, deploy this repository's updated
`scripts/build-cloud.mjs` and set `VITE_API_URL=https://api.oneinfo.online` for its
production build, then redeploy using the project owner's account. Its origin is
already allowed by the VPS CORS configuration. Configure the root customer domain
before producing cards: `PUBLIC_CARD_BASE_URL=https://oneinfo.online/c` currently
targets a parked page until the frontend is attached there. Existing card links
are never rewritten by changing the environment.

## Verification performed

- Both containers healthy; database migrations successful.
- Public HTTPS certificate and health endpoint verified from outside the VPS.
- Public catalog and authenticated Admin catalog successful; anonymous Admin denied.
- Admin password login and browser-origin CORS preflight successful.
- Authorized SVG upload and public readback successful; only that generated test
  upload was removed afterward.
- Public local-NFC and development endpoints return 404.
- Existing AriseSell health remained successful at its original release revision.
- API build, three proxy regression tests, production dependency startup check,
  and Compose validation passed locally; actual Docker images built on the VPS.

No real order, email, payment, card production, printer or physical NFC operation
was performed. No existing application data or secrets were migrated or reset.

# VPS backend: API + PostgreSQL

This setup creates an independent `oneinfo-vps` Compose project with API and
PostgreSQL 17 containers, persistent database/media volumes, and a manual
migration task. It starts with an empty database; it does not copy Neon data.
The storefront and Admin remain separately hosted.

Examples assume a Linux VPS with Docker Compose v2 and a **host-installed Nginx**.
`oneinfo.online` is the customer website; `api.oneinfo.online` is the API.
If your existing proxy is a container or hosting panel, adapt its upstream network
instead: `127.0.0.1` inside a proxy container refers to that container, not the VPS.
Do not install a second proxy on occupied ports 80/443.

## 1. Prepare the checkout and environment

Copy this updated repository to the VPS, or clone it after these files have been
committed and pushed. Run all commands from its root in Bash.

```bash
cp deploy/vps.env.example .env.vps
chmod 600 .env.vps
openssl rand -hex 32
openssl rand -hex 32
nano .env.vps
```

Use the first generated value as `POSTGRES_PASSWORD` and the second as
`JWT_SECRET`. Keep the database password hexadecimal so the Compose-generated
database URL does not need URL encoding. Use your real frontend origins in
`CORS_ORIGIN` (comma-separated, without trailing slashes).

Generate the Admin password hash without putting its plaintext in shell history:

```bash
read -rsp 'Admin password: ' ADMIN_PASSWORD; echo
printf '%s' "$ADMIN_PASSWORD" | docker run --rm -i node:24-bookworm-slim node -e 'const {randomBytes,scryptSync}=require("node:crypto"); let p=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",c=>p+=c); process.stdin.on("end",()=>{if(!p)throw Error("Password is required");const s=randomBytes(16).toString("hex");console.log("scrypt:"+s+":"+scryptSync(p,s,64).toString("hex"));});'
unset ADMIN_PASSWORD
```

Uncomment `ADMIN_PASSWORD_HASH` in `.env.vps` and replace its example with the
complete printed `scrypt:...` value. Set your Admin email as well. Do not set
`VERCEL` on this server. Email delivery is optional and requires the Resend values.

`PUBLIC_CARD_BASE_URL` must be the permanent **frontend** `/c` URL. Keep the old
card domain alive if cards have already been printed; this setting does not
rewrite existing links. Local NFC workstations sharing this new database must
also use its database, signing secret and card base URL over a private connection.
Do not publish PostgreSQL port 5432 to connect them; use a VPN/SSH tunnel.

## 2. Build, migrate, then start

```bash
docker compose --env-file .env.vps -f compose.vps.yaml build api migrate
docker compose --env-file .env.vps -f compose.vps.yaml up -d postgres
docker compose --env-file .env.vps -f compose.vps.yaml run --rm migrate
```

Continue only if the migration command succeeds:

```bash
docker compose --env-file .env.vps -f compose.vps.yaml up -d api
docker compose --env-file .env.vps -f compose.vps.yaml ps
curl --fail http://127.0.0.1:3301/health
curl --fail http://127.0.0.1:3301/api/v1/products/public
```

The products endpoint also checks database connectivity; an empty catalog is
normal apart from products inserted by migrations. `/health` only checks the API
process. Migrations run explicitly, rather than automatically on every restart.
The API port is published only on the VPS loopback interface; PostgreSQL has no
published port. Choose another host port in Compose and Nginx if 3301 is occupied.

## 3. DNS and HTTPS

Create a DNS **A record** for `api.oneinfo.online` pointing to the VPS IPv4.
Only add an AAAA record if the VPS and proxy also serve IPv6. Keep the root
`oneinfo.online` record pointing to the frontend host.

For host-installed Nginx, create `/etc/nginx/sites-available/oneinfo-api`:

```nginx
server {
    listen 80;
    server_name api.oneinfo.online;
    client_max_body_size 10m;

    location = /api/v1/local-nfc { return 404; }
    location ^~ /api/v1/local-nfc/ { return 404; }
    location = /api/v1/dev { return 404; }
    location ^~ /api/v1/dev/ { return 404; }

    location / {
        proxy_pass http://127.0.0.1:3301;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Overwrite untrusted headers; TRUST_PROXY_HOPS=1 trusts this hop only.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

On Debian/Ubuntu with Nginx and Certbot already installed:

```bash
sudo ln -s /etc/nginx/sites-available/oneinfo-api /etc/nginx/sites-enabled/oneinfo-api
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.oneinfo.online
curl --fail https://api.oneinfo.online/health
curl --fail https://api.oneinfo.online/api/v1/products/public
```

Keep SSH access and allow HTTP/HTTPS in the VPS/provider firewall. Ports 3301 and
5432 do not need public firewall rules. With a CDN or more proxy layers, configure
the front proxy's verified client-IP handling before changing trusted hops.

## 4. Point the frontend to the VPS

Build the storefront and Control Center with:

```dotenv
VITE_API_URL=https://api.oneinfo.online
VITE_OPERATOR_LOGIN=password
PUBLIC_SITE_URL=https://oneinfo.online
```

`npm run build:cloud` now respects an explicitly configured `VITE_API_URL`, while
retaining same-origin requests by default. For a Vercel frontend, set these build
environment variables and redeploy after deploying this code. Vite embeds the API
URL during the build; changing only the backend environment does not update it.
Direct frontend requests to the VPS use the listed CORS origins.

Check Admin password sign-in and catalog requests in the browser before switching
customers over. Existing customers/orders/catalog/media are not automatically
copied from the previous database/storage. Existing uploaded media URLs may still
depend on the old host. The phone's USB/ADB bridge stays on the local workstation.

## 5. Backup, update, logs

Before a schema update, save a PostgreSQL dump and a copy of product media:

```bash
mkdir -p .oneinfo/backups
chmod 700 .oneinfo/backups
docker compose --env-file .env.vps -f compose.vps.yaml exec -T postgres pg_dump -U oneinfo -d oneinfo -Fc > ".oneinfo/backups/oneinfo-$(date +%F-%H%M%S).dump"
docker compose --env-file .env.vps -f compose.vps.yaml cp api:/app/.product-media ".oneinfo/backups/media-$(date +%F-%H%M%S)"
```

Keep encrypted copies off the VPS and verify restoration separately. A Docker
volume survives container recreation but is not a backup. Do not use
`docker compose down -v`: it deletes the database and media volumes. Changing
`POSTGRES_PASSWORD` after database initialization does not change its stored role
password; rotate both deliberately.

For an update, pull/copy the reviewed code, back up, build both targets, run the
migration successfully, then recreate the API using the same commands as step 2.
Some schema changes may need a maintenance window. Inspect logs with:

```bash
docker compose --env-file .env.vps -f compose.vps.yaml logs --tail=100 api postgres
```

Reference: [Compose startup dependencies](https://docs.docker.com/compose/how-tos/startup-order/),
[Docker port publishing](https://docs.docker.com/engine/network/port-publishing/),
[Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

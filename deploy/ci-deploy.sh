#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# The alternate root is used by the isolated deployment regression tests.
root=${ONEINFO_DEPLOY_ROOT:-/opt/oneinfo}
read -r action revision extra <<< "${1:-}"
if [[ "$action" == status && -z "${revision:-}${extra:-}" ]]; then
  cat "$root/current-release" 2>/dev/null || echo legacy
  exit 0
fi
[[ "$action" =~ ^(upload|deploy)$ && "${revision:-}" =~ ^[a-f0-9]{40}$ && -z "${extra:-}" ]] || { echo 'Invalid deployment request' >&2; exit 2; }
mkdir -p "$root/releases" "$root/backups"
exec 9>"$root/.deploy.lock"
flock -w 1200 9
archive="$root/releases/$revision.tar.gz"
if [[ "$action" == upload ]]; then
  temporary=$(mktemp "$root/releases/upload.XXXXXX")
  trap 'rm -f "$temporary"' EXIT
  head -c 52428801 > "$temporary"
  [[ $(wc -c < "$temporary") -le 52428800 ]] || { echo 'Release archive too large' >&2; exit 2; }
  gzip -t "$temporary"
  mv "$temporary" "$archive"
  exit 0
fi
[[ -s "$archive" && -f "$root/.env.vps" ]] || { echo 'Release or server environment missing' >&2; exit 2; }
release="$root/releases/$revision"
mkdir -p "$release"
python3 - "$archive" "$release" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
allowed={'Dockerfile.api','.dockerignore','package.json','package-lock.json','tsconfig.base.json','apps','packages','compose.vps.yaml','deploy'}
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=[]
    total=0
    for member in archive:
        total+=member.size
        if len(members)>=10000 or total>200*1024*1024:
            raise SystemExit('Expanded release archive too large')
        path=PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in allowed or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe release archive member')
        members.append(member)
    archive.extractall(sys.argv[2], members=members, filter='data')
PY
[[ -f "$release/Dockerfile.api" && -f "$release/compose.vps.yaml" ]] || exit 2
previous=$(docker inspect --format '{{.Image}}' oneinfo-vps-api-1)
previous_compose="$root/compose.vps.yaml"
previous_revision=$(cat "$root/current-release" 2>/dev/null || true)
if [[ "$previous_revision" =~ ^[a-f0-9]{40}$ && -f "$root/releases/$previous_revision/compose.vps.yaml" ]]; then
  previous_compose="$root/releases/$previous_revision/compose.vps.yaml"
fi
docker tag "$previous" "oneinfo-vps-api:rollback-$revision"
docker build --label "org.opencontainers.image.revision=$revision" --target runtime -t "oneinfo-vps-api:$revision" -f "$release/Dockerfile.api" "$release"
docker build --target build -t "oneinfo-vps-migrate:$revision" -f "$release/Dockerfile.api" "$release"
backup="$root/backups/ci-$(date -u +%Y%m%dT%H%M%S)-$revision"
mkdir "$backup"
docker exec oneinfo-vps-postgres-1 pg_dump -U oneinfo -d oneinfo -Fc --no-owner > "$backup/database.dump"
[[ -s "$backup/database.dump" ]]
docker exec -i oneinfo-vps-postgres-1 pg_restore --list < "$backup/database.dump" > "$backup/database.contents"
media=$(docker volume inspect --format '{{.Mountpoint}}' oneinfo-vps_product-media)
tar -czf "$backup/media.tar.gz" -C "$media" .
tar -tzf "$backup/media.tar.gz" > "$backup/media.contents"
cat > "$release/images.yaml" <<EOF
services:
  api:
    image: oneinfo-vps-api:$revision
    build:
      context: $release
  migrate:
    image: oneinfo-vps-migrate:$revision
    build:
      context: $release
EOF
compose=(docker compose --project-directory "$root" --env-file "$root/.env.vps" -p oneinfo-vps -f "$release/compose.vps.yaml" -f "$root/deploy/compose.docker-proxy.yaml" -f "$release/images.yaml")
# Migrations must remain compatible with the previous API; schema rollback is manual.
"${compose[@]}" run --rm --no-deps migrate
cutover=false
rollback() {
  local code=$?
  trap - ERR INT TERM HUP
  if [[ "$cutover" == true ]]; then
    echo 'Deployment failed; restoring the previous Oneinfo API image.' >&2
    cat > "$release/rollback.yaml" <<EOF
services:
  api:
    image: oneinfo-vps-api:rollback-$revision
EOF
    docker compose --project-directory "$root" --env-file "$root/.env.vps" -p oneinfo-vps -f "$previous_compose" -f "$root/deploy/compose.docker-proxy.yaml" -f "$release/rollback.yaml" up -d --no-deps --no-build --wait --wait-timeout 120 api || echo 'ROLLBACK NEEDS OPERATOR ATTENTION' >&2
  fi
  exit "${code:-1}"
}
trap rollback ERR
trap 'false' INT TERM HUP
cutover=true
"${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 120 api
curl --fail --silent --show-error --retry 3 --retry-delay 2 --max-time 20 http://127.0.0.1:3301/api/v1/products/public > /dev/null
curl --fail --silent --show-error --retry 3 --retry-delay 2 --max-time 20 https://api.oneinfo.online/health > /dev/null
docker tag "oneinfo-vps-api:$revision" oneinfo-vps-api:latest
docker tag "oneinfo-vps-migrate:$revision" oneinfo-vps-migrate:latest
printf '%s\n' "$revision" > "$root/current-release.tmp"
mv "$root/current-release.tmp" "$root/current-release"
echo "Oneinfo API deployed: $revision"

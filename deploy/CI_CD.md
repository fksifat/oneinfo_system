# Oneinfo CI/CD

GitHub Actions runs `.github/workflows/ci-cd.yml` on pull requests, pushes to
`main`, and manual runs on `main`.

`Web checks` installs the lockfile, typechecks, runs unit and isolated PostgreSQL
workflow tests, tests the deployment failure paths, builds all web apps, runs the
real Chrome regression suite and builds the Vercel output. CI uses its own
PostgreSQL service and dummy signing key; production database secrets are not
available to test jobs. `Android checks` runs JVM tests and builds an installable
debug APK, retained as a workflow artifact for 14 days. It does not install on a
phone or write NFC tags.

Both checks are required before merging into protected `main`. Vercel retains
its Git integration: pull requests get previews and merges deploy the frontend.
The hosted frontend uses `https://api.oneinfo.online`.

## VPS deployment

Only a successful `main` workflow can use the GitHub `production` environment.
Its secrets are `ONEINFO_DEPLOY_KEY` and `ONEINFO_KNOWN_HOSTS`; its variable
`ONEINFO_DEPLOY_HOST` selects the restricted SSH account. These are configured in
GitHub environment settings, never committed. The host key is copied from the
workstation's already verified known-hosts entry, not accepted at runtime.

The runner uploads an archive of the tested commit's backend, contracts and
deployment files. The VPS deployment entry point is installed root-owned as
`/usr/local/sbin/oneinfo-ci-deploy`, from `deploy/ci-deploy.sh`. The dedicated
`oneinfo-ci` user's key has a forced command through
`/usr/local/bin/oneinfo-ci-request`; it cannot run arbitrary SSH commands or
forward ports. Its sudo rule permits only that validated deployment entry point.
Changes to the trusted deployment entry point require an operator to review and
reinstall it, rather than allowing an uploaded archive to replace its own guard.

The entry point serializes deployments with `/opt/oneinfo/.deploy.lock` and:

1. Validates the commit ID and release archive, rejecting links, traversal and
   expansion beyond 200 MB/10,000 entries.
2. Builds revision-tagged API and migration images; records the revision in the
   API image's OCI labels and pins the previous image for rollback.
3. Backs up the Oneinfo PostgreSQL database and media volume, validating archive
   listings, beneath `/opt/oneinfo/backups/ci-TIMESTAMP-SHA/`.
4. Runs migrations before changing the running API. A failed migration leaves the
   old API running and fails the workflow.
5. Recreates **only** the `oneinfo-vps` API with `--no-deps --no-build --wait`.
6. Checks the database-backed catalog through the local API and public HTTPS
   health endpoint. A failed cutover restores the previous API image using its
   last successful release's Compose configuration.
7. Updates `/opt/oneinfo/current-release` and the normal API image tag only after
   successful checks.

PostgreSQL and media volumes, Nginx and other applications are not recreated.
Server credentials stay in `/opt/oneinfo/.env.vps`. Release source is retained
under `/opt/oneinfo/releases/SHA/`; `/opt/oneinfo`'s old source copy is no longer
the source used by CI builds. Use GitHub Actions for code updates. An environment
change can still recreate only the API with the documented root Compose command
and the latest image, without rebuilding the old source copy.

## Failures and recovery

Review the failed workflow logs first. Re-run the workflow on `main` after fixing
the cause. The deployment user accepts `status`, `upload SHA`, and `deploy SHA`;
all other requests are rejected. An operator can run the same entry point
locally on the VPS for a reviewed uploaded revision.

Database migrations must be backward compatible with the previous API. An image
rollback does **not** undo schema migrations or automatically restore database
backups over new orders. Destructive schema changes need a separate migration
and recovery plan. CI backups are live backups on the same VPS; off-server backup,
retention cleanup and a complete restore drill are separate operator work.

Local deployment regressions: `node --test scripts/ci-deploy.test.mjs`.

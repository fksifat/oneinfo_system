# Legacy Oneinfo storefront

This folder preserves the original static storefront and its cart/accessibility fixes. The active managed catalog/checkout storefront is in `sites/storefront`.

The files under `dist/` are intentionally tracked here: they are the source artifacts for this older static site and are used by the storefront regression checks. This folder was previously an unresolved Git link without a submodule mapping or remote; it is now ordinary files so a fresh clone includes them.

The original nested Git history is backed up locally under `.oneinfo/git-backups/legacy-storefront-git/`. Publishing this repository does not redeploy either storefront.

# Hosting

The app is a static Vite site on Vercel. The large sample worlds, atlas, in-world audio and weather resources load directly from a dedicated Cloudflare R2 bucket. Vercel does not proxy or copy those files.

## Default release

`deployment/asset-release.json` records the immutable public asset URL. `deployment/asset-checks.json` pins SHA-256 hashes for 33 files, including startup data and all 14 sample worlds' nearest spawn mesh/voxel columns. A fresh source clone can verify this release without a local asset workspace or Git history.

`npm run dev` and `npm run build` use the recorded URL by default. `VITE_ASSET_BASE_URL` can override it with a public HTTPS URL ending in a 40-character hexadecimal release ID. URLs containing credentials, query strings or fragments are rejected.

## Vercel

`vercel.json` uses `npm ci`, `npm run build:vercel` and `dist`. The build verifies published assets before compiling. Missing files, mismatched pinned hashes, CORS failures and inappropriate compressed-chunk headers stop deployment.

The output contains JavaScript, CSS, HTML, the favicon and the small runtime menu/font/import-data bundle. A 100 MiB project budget rejects oversized output; any `generated/` directory in the build output is rejected. `.vercelignore` also excludes local asset workspaces and caches from CLI source uploads.

No environment variables are necessary for the default release. Existing Production/Preview overrides can remain if they point to the same recorded release.

## Cloudflare build challenges

If the custom CDN returns HTTP 403 with `cf-mitigated: challenge`, build verification can use the release's recorded R2 development URL. This happens only for that specific challenge, not ordinary 403/404 failures. Custom releases can set `ASSET_CHECK_BASE_URL`; it must use an R2 development hostname and the exact same immutable path.

The browser continues using the custom CDN. The fallback verifies the same pinned bytes, CORS, and compression headers and is not the production serving URL. It does not require changing Cloudflare security settings for other sites.

## CDN requirements

- Public HTTPS access with GET/HEAD CORS; see `deployment/r2-cors.json`.
- Immutable versioned URLs, with `Cache-Control: public,max-age=31536000,immutable`.
- No `Content-Encoding: gzip` on stored `.gz` chunks: the viewer decompresses them itself.
- A custom production domain; the R2 development endpoint is only a build verification fallback.
- No credentials in Git or browser-exposed `VITE_*` variables.

See [asset maintenance](assets.md) for optional generation and publishing. Reusing the existing release avoids additional storage per application deployment.

## Usage

This layout keeps the multi-GB assets out of Vercel Deployment Storage and routes their traffic directly to R2. Deployment history still consumes Vercel storage; deleting assets from a new build does not remove older deployments. Review usage and retention in the relevant project dashboard.

Service limits may change; check the official [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby), [Vercel limits](https://vercel.com/docs/limits), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) and [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) before changing plans or publishing a new asset version.

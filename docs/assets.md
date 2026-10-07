# Asset maintenance

Normal development and deployment use the existing immutable R2 release. The original world archives, resource packs, native reference textures, and generated sample chunks are intentionally excluded from Git. They are not required for `npm ci`, `npm test`, `npm run dev` or `npm run build`.

## Optional workspaces

Asset maintainers can supply these local directories from a separately maintained private workspace:

- `minecraft-memory-assets/resourcepacks/`: source resource packs for each theme.
- `minecraft-memory-assets/references/native-data/`: native models, block states, textures and references.
- `minecraft-memory-assets/worlds/templates/`: original tutorial and Mash-up template metadata.
- `minecraft-memory-assets/worlds/archives/`: original source world ZIPs.
- `public/generated/`: converted manifests, atlases, chunks, UI and audio.

Both workspace roots are ignored by Git and Vercel CLI uploads. They must stay outside public Git history, including archive ZIPs. Downloading from the public CDN does not restore the original conversion inputs.

The retained conversion commands include `assets`, `weather-assets`, `building-assets`, `particle-assets`, `fluid-assets`, `ui-assets` and `viewer-data`. They require the original input layout above. `npm run test:assets` runs the complete original integration checks against those local workspaces.

Menu resources can be extracted from a supplied offline client with `npm run menu-assets -- <path-to-offline-client.html>`. The script reads its embedded resources without executing the client. `npm run ui-language` regenerates item names and menu translations using the original UI asset catalog and native language resources.

## Publishing a changed asset release

1. Generate and run all asset integration checks locally.
2. Choose a new immutable 40-character hexadecimal `ASSET_VERSION`; never reuse an existing version for changed files.
3. Configure a bucket-scoped AWS CLI profile and the R2 values in `.env.local`. Credentials must never use the `VITE_` prefix.
4. Inspect `npm run assets:publish -- --dry-run`, then run `npm run assets:publish`. Existing versions are verified rather than overwritten.
5. Update `deployment/asset-release.json` and regenerate `deployment/asset-checks.json` with `npm run assets:pin`. Only small release metadata and hashes are committed.
6. Set deployment URL overrides to the new release if used; verify `npm run assets:verify` and `npm run build:vercel`.

Application updates reuse the existing release. No generated chunks are committed or re-uploaded for code-only changes.

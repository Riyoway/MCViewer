import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export const APP_BUDGET = 100 * 1024 * 1024; // Project budget, not Vercel's Git deployment limit.
export function assetVersion() {
  const version = execFileSync('git', ['log', '-1', '--format=%H', '--', 'public/generated'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(version)) throw new Error('Generated assets must be committed before publishing.');
  return version;
}
export function externalAssetUrl(value: string | undefined, required = false) {
  if (!value?.trim()) {
    if (required) throw new Error('Vercel builds require VITE_ASSET_BASE_URL. Publish public/generated to an external CDN first; see docs/hosting.md. Refusing to copy the multi-GB world assets into this deployment.');
    return undefined;
  }
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('VITE_ASSET_BASE_URL must be a public HTTPS URL without credentials, query or fragment.');
  if (!/\/[a-f0-9]{40}\/?$/.test(url.pathname))
    throw new Error('VITE_ASSET_BASE_URL must end with an immutable asset commit SHA (40 hex characters).');
  return url.href.replace(/\/$/, '');
}
export async function inventory(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in deployment output: ${entry.name}`);
    if (entry.isDirectory()) { const child = await inventory(path); files += child.files; bytes += child.bytes; }
    else if (entry.isFile()) { files++; bytes += (await stat(path)).size; }
  }
  return { files, bytes };
}
export async function checkAppOutput(directory: string) {
  const size = await inventory(directory);
  if (size.bytes > APP_BUDGET) throw new Error(`Vercel output exceeds the project's 100 MiB budget (${(size.bytes / 1024 ** 2).toFixed(1)} MiB). Keep generated world assets on the external CDN.`);
  try { await stat(join(directory, 'generated')); throw new Error('Generated assets leaked into the Vercel output.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const file of ['index.html', 'menu/logo.png', 'menu/viewer-data.json', 'menu/native-models.json', 'favicon.svg']) await stat(join(directory, file));
  return size;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function verifyCdn(base: string, origin: string, root = resolve('public/generated')) {
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  // Verify every sample's spawn data, plus the startup textures/data. A 200 HTML error page must fail too.
  const paths = new Set<string>(['manifest.json', 'atlas.png', 'steve.png', 'weather/assets.json', 'ui/assets.json']);
  for (const world of Object.values(manifest.worlds) as any[]) {
    const nearest = [...world.chunks].sort((a, b) =>
      Math.hypot(a.origin[0] - world.spawn[0], a.origin[2] - world.spawn[2]) - Math.hypot(b.origin[0] - world.spawn[0], b.origin[2] - world.spawn[2]))[0];
    if (!nearest) throw new Error('Sample world has no chunks.');
    paths.add(nearest.file); paths.add(nearest.voxels);
  }
  for (const file of paths) {
    const response = await fetch(`${base}/${file}`, { headers: { Origin: origin }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`CDN is missing ${file} (HTTP ${response.status}).`); }
    const cors = response.headers.get('access-control-allow-origin');
    if (cors !== '*' && cors !== origin) { await response.body?.cancel(); throw new Error(`CDN CORS does not allow ${origin}: ${file}`); }
    if (/\.gz$/.test(file) && response.headers.get('content-encoding')) { await response.body?.cancel(); throw new Error(`Do not set Content-Encoding on the already-compressed chunk file: ${file}`); }
    const remote = new Uint8Array(await response.arrayBuffer()), local = file === 'manifest.json' ? manifestBytes : await readFile(join(root, file));
    if (digest(remote) !== digest(local)) throw new Error(`CDN assets differ from this checkout: ${file}. Publish a new version instead of overwriting immutable URLs.`);
  }
  console.log(`CDN verified: ${paths.size} files, all ${Object.keys(manifest.worlds).length} sample worlds, CORS and exact content.`);
}
function aws(args: string[]) {
  const result = spawnSync('aws', args, { stdio: 'inherit', shell: false });
  if (result.error) throw new Error('AWS CLI is required to publish assets. Install it and configure a bucket-scoped R2 profile; see docs/hosting.md.');
  if (result.status !== 0) throw new Error('R2 upload failed. No application deployment should be promoted yet.');
}
async function main() {
  const env = { ...loadEnv(process.argv.includes('--vercel') ? 'vercel' : 'production', process.cwd(), ''), ...process.env }, action = process.argv[2];
  if (action === 'output') {
    const size = await checkAppOutput(resolve(process.argv[3] || 'dist'));
    console.log(`Vercel output: ${(size.bytes / 1024 ** 2).toFixed(2)} MiB, ${size.files} files; no generated assets.`);
    return;
  }
  if (action === 'verify') {
    await verifyCdn(externalAssetUrl(env.VITE_ASSET_BASE_URL, true)!, env.ASSET_CHECK_ORIGIN || 'https://mineconsole.riyo.me');
    return;
  }
  const version = assetVersion(), size = await inventory(resolve('public/generated'));
  console.log(`Generated assets: ${(size.bytes / 1024 ** 3).toFixed(2)} GiB, ${size.files} files, version ${version}.`);
  if (action === 'report') return;
  if (action !== 'publish') throw new Error('Use hosting.ts report | publish [--dry-run] | verify | output [directory].');
  if (execFileSync('git', ['status', '--porcelain', '--', 'public/generated'], { encoding: 'utf8' }).trim())
    throw new Error('Commit generated asset changes before publishing an immutable version.');
  if (size.bytes > 8 * 1024 ** 3) throw new Error('Asset version exceeds the 8 GiB safety budget. Review R2 usage before uploading.');
  const { R2_ACCOUNT_ID: account, R2_BUCKET: bucket, R2_PUBLIC_URL: publicUrl } = env;
  if (!/^[a-f0-9]{32}$/.test(account || '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || ''))
    throw new Error('Set R2_ACCOUNT_ID (32 hex characters) and R2_BUCKET in .env.local.');
  if (!publicUrl) throw new Error('Set R2_PUBLIC_URL to the public HTTPS bucket domain in .env.local.');
  const base = externalAssetUrl(`${publicUrl?.replace(/\/$/, '')}/generated/${version}`, true)!;
  const origin = env.ASSET_CHECK_ORIGIN || 'https://mineconsole.riyo.me', dryRun = process.argv.includes('--dry-run');
  if (!dryRun) {
    const existing = await fetch(`${base}/manifest.json`, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    if (existing.ok) { await verifyCdn(base, origin); console.log(`Already published. VITE_ASSET_BASE_URL=${base}`); return; }
    if (existing.status !== 404) throw new Error(`Cannot inspect CDN version (HTTP ${existing.status}). Check bucket/domain configuration first.`);
  }
  const common = ['--endpoint-url', `https://${account}.r2.cloudflarestorage.com`, '--region', 'auto', '--profile', env.R2_PROFILE || 'minecraft-assets'];
  const target = `s3://${bucket}/generated/${version}`;
  const commands = [
    ['s3', 'sync', 'public/generated', target, '--exclude', 'manifest.json', '--cache-control', 'public,max-age=31536000,immutable', '--no-progress', ...common],
    // Publish the manifest only after all data is uploaded successfully. Never delete existing versions.
    ['s3', 'cp', 'public/generated/manifest.json', `${target}/manifest.json`, '--content-type', 'application/json', '--cache-control', 'public,max-age=31536000,immutable', '--no-progress', ...common],
  ];
  for (const args of commands) {
    if (dryRun) console.log(JSON.stringify(['aws', ...args]));
    else aws(args);
  }
  if (!dryRun) await verifyCdn(base, origin);
  console.log(`${dryRun ? 'Planned configuration' : 'Published'}: VITE_ASSET_BASE_URL=${base}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });

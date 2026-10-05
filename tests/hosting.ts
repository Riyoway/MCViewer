import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_BUDGET, externalAssetUrl, inventory, checkAppOutput, verifyCdn } from '../scripts/hosting.ts';

const sha = 'a'.repeat(40), base = `https://cdn.example.com/generated/${sha}`;
assert.equal(externalAssetUrl(undefined), undefined);
assert.equal(externalAssetUrl(`${base}/`, true), base);
for (const value of ['', 'http://cdn.example.com/' + sha, 'https://user:secret@cdn.example.com/' + sha, base + '?token=secret', base + '#fragment', 'https://cdn.example.com/generated/latest'])
  assert.throws(() => externalAssetUrl(value, true));

const directory = await mkdtemp(join(tmpdir(), 'minecraft-hosting-'));
const originalFetch = globalThis.fetch;
try {
  const files: Record<string, Uint8Array> = {};
  const text = new TextEncoder();
  const manifest = { worlds: { fixture: { spawn: [10, 64, 10], chunks: [
    { origin: [160, 0, 160], file: 'fixture/far.gz', voxels: 'fixture/far-vox.gz' },
    { origin: [0, 0, 0], file: 'fixture/spawn.gz', voxels: 'fixture/spawn-vox.gz' },
  ] } } };
  for (const file of ['atlas.png', 'steve.png', 'weather/assets.json', 'ui/assets.json', 'fixture/spawn.gz', 'fixture/spawn-vox.gz', 'manifest.json']) {
    files[file] = text.encode(file === 'manifest.json' ? JSON.stringify(manifest) : file);
    const path = join(directory, file); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, files[file]);
  }
  let failure: 'cors' | 'missing' | 'content' | 'encoding' | 'blocked' | undefined;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Origin, 'https://viewer.example.com');
    const path = String(url).slice(base.length + 1); requested.push(path);
    const headers: Record<string, string> = { 'Access-Control-Allow-Origin': failure === 'cors' ? 'https://other.example.com' : '*' };
    if (failure === 'encoding' && path.endsWith('.gz')) headers['Content-Encoding'] = 'gzip';
    if (failure === 'blocked') {
      return new Response('<title>Attention Required! | Cloudflare</title>', { status: 403, headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'fixture-ray', server: 'cloudflare' } });
    }
    return new Response(failure === 'content' ? 'HTML error page' : files[path] as BodyInit, { status: failure === 'missing' ? 404 : 200, headers });
  }) as typeof fetch;
  await verifyCdn(base, 'https://viewer.example.com', directory);
  assert(requested.includes('fixture/spawn.gz')); assert(!requested.includes('fixture/far.gz'));
  for (const [kind, message] of [['cors', /CORS/], ['missing', /HTTP 404/], ['content', /differ/], ['encoding', /Content-Encoding/]] as const) {
    failure = kind; await assert.rejects(verifyCdn(base, 'https://viewer.example.com', directory), message);
  }
  failure = 'blocked';
  await assert.rejects(verifyCdn(base, 'https://viewer.example.com', directory), error => {
    const message = (error as Error).message;
    return message.includes(`${base}/manifest.json`) && message.includes('HTTP 403') && message.includes('cf-mitigated=challenge') && message.includes('fixture-ray') && message.includes('Cloudflare');
  });
  const fallback = `https://pub-${'b'.repeat(32)}.r2.dev/generated/${sha}`;
  await assert.rejects(verifyCdn(base, 'https://viewer.example.com', directory, fallback.replace(sha, 'c'.repeat(40))), /same immutable asset path/);
  await assert.rejects(verifyCdn(base, 'https://viewer.example.com', directory, base), /R2 development hostname/);
  let fallbackFailure: 'missing' | 'denied' | 'content' | 'cors' | undefined;
  const fallbackRequests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Origin, 'https://viewer.example.com');
    const address = String(url); fallbackRequests.push(address);
    if (address.startsWith(base + '/')) {
      if (fallbackFailure === 'missing') return new Response('Missing', { status: 404 });
      if (fallbackFailure === 'denied') return new Response('AccessDenied', { status: 403 });
      return new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    }
    assert(address.startsWith(fallback + '/'));
    const path = address.slice(fallback.length + 1);
    return new Response(fallbackFailure === 'content' ? 'corrupt' : files[path] as BodyInit, { headers: { 'Access-Control-Allow-Origin': fallbackFailure === 'cors' ? 'https://other.example.com' : '*' } });
  }) as typeof fetch;
  await verifyCdn(base, 'https://viewer.example.com', directory, fallback);
  assert.equal(fallbackRequests.filter(url => url.startsWith(base + '/')).length, 1);
  assert.equal(fallbackRequests.filter(url => url.startsWith(fallback + '/')).length, 7);
  for (const [kind, message] of [['missing', /HTTP 404/], ['denied', /HTTP 403/], ['content', /differ/], ['cors', /CORS/]] as const) {
    fallbackFailure = kind; fallbackRequests.length = 0;
    await assert.rejects(verifyCdn(base, 'https://viewer.example.com', directory, fallback), message);
    if (kind === 'missing' || kind === 'denied') assert.equal(fallbackRequests.filter(url => url.startsWith(fallback + '/')).length, 0);
  }
  assert.equal((await inventory(directory)).files, 7);
  const app = join(directory, 'app'); await mkdir(join(app, 'menu'), { recursive: true });
  for (const file of ['index.html', 'menu/logo.png', 'menu/viewer-data.json', 'menu/native-models.json', 'favicon.svg']) await writeFile(join(app, file), 'fixture');
  assert.equal((await checkAppOutput(app)).files, 5);
  await mkdir(join(app, 'generated'));
  await assert.rejects(checkAppOutput(app), /leaked/);
  await rm(join(app, 'generated'), { recursive: true });
  const large = await open(join(app, 'large.bin'), 'w'); await large.truncate(APP_BUDGET + 1); await large.close();
  await assert.rejects(checkAppOutput(app), /budget/);
} finally {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
}
console.log('Hosting checks passed: immutable HTTPS URLs, CORS, content/version mismatch, every sample spawn, compressed chunk headers and output size budget.');

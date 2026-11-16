import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {languages,type Catalog} from '../src/ui/Language.ts';

const markup = await readFile('src/ui/menus.html', 'utf8');
assert(markup.includes('id="home-multiplayer"'), 'missing home-multiplayer entry button');
assert(markup.includes('id="multiplayer-menu"'), 'missing multiplayer-menu screen');
assert(markup.includes('id="room-menu"'), 'missing room-menu screen');
assert(markup.indexOf('id="home-multiplayer"') > markup.indexOf('id="home-samples"'), 'home-multiplayer must follow home-samples');

// Room flow is wired, not stubbed: create/join enabled, code input +
// invalid-code slot, signal copy-paste, progress/cancel, room play.
for (const id of ['mp-world', 'create-room', 'join-room', 'room-code-input', 'room-error', 'room-code', 'room-world', 'signal-offer', 'signal-answer', 'signal-connect', 'room-play', 'room-status', 'transfer-progress', 'room-back']) {
  assert(markup.includes(`id="${id}"`), `missing room UI: ${id}`);
}
assert(!markup.includes('id="create-room" disabled'), 'create-room must be enabled');
assert(!markup.includes('id="join-room" disabled'), 'join-room must be enabled');
assert(markup.indexOf('id="mp-world"') < markup.indexOf('id="room-code-input"'), 'world picker must precede room code');
const native = await readFile('src/ui/NativeOptions.ts', 'utf8');
assert(native.includes('mp-world'), 'world picker must keep its native dropdown (cycling cannot list 14+ worlds)');

const main = await readFile('src/main.ts', 'utf8');
assert(main.includes('openMultiplayer'), 'missing openMultiplayer接点');
assert(main.includes("menu('multiplayer-menu')"), 'multiplayer-menu unreachable from menu()');
assert(main.includes("mp-world"), 'create flow must read the multiplayer world picker');

for (const [code] of languages) {
  const data: Catalog = JSON.parse(await readFile(`public/menu/locales/${code}.json`, 'utf8'));
  for (const key of ['Multiplayer', 'Create', 'Join', 'Room code', 'Invalid room code', 'Offer', 'Answer', 'Connect', 'Waiting for connection...', 'Receiving world...', 'World ready']) {
    assert(data.ui[key]?.trim(), `${code}: missing ${key}`);
  }
}
console.log('Multiplayer entry UI: buttons, screens and locale keys passed.');

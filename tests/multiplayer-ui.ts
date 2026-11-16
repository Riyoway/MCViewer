import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {languages,type Catalog} from '../src/ui/Language.ts';

const markup = await readFile('src/ui/menus.html', 'utf8');
assert(markup.includes('id="home-multiplayer"'), 'missing home-multiplayer entry button');
assert(markup.includes('id="multiplayer-menu"'), 'missing multiplayer-menu screen');
assert(markup.includes('id="room-menu"'), 'missing room-menu screen');
assert(markup.indexOf('id="home-multiplayer"') > markup.indexOf('id="home-samples"'), 'home-multiplayer must follow home-samples');

const main = await readFile('src/main.ts', 'utf8');
assert(main.includes('openMultiplayer'), 'missing openMultiplayer接点');
assert(main.includes("menu('multiplayer-menu')"), 'multiplayer-menu unreachable from menu()');

for (const [code] of languages) {
  const data: Catalog = JSON.parse(await readFile(`public/menu/locales/${code}.json`, 'utf8'));
  for (const key of ['Multiplayer', 'Create', 'Join', 'Room code']) {
    assert(data.ui[key]?.trim(), `${code}: missing ${key}`);
  }
}
console.log('Multiplayer entry UI: buttons, screens and locale keys passed.');

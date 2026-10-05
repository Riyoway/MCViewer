import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {languages,validLocale,translate,type Catalog} from '../src/ui/Language.ts';
import {translations} from '../scripts/ui-translations.ts';

const names=JSON.parse(await readFile('public/menu/item-names.json','utf8'));
const catalogs:Record<string,Catalog>={};
for(const [code] of languages){
  const data:Catalog=JSON.parse(await readFile(`public/menu/locales/${code}.json`,'utf8'));catalogs[code]=data;
  assert.deepEqual(Object.keys(data.ui).sort(),Object.keys(translations).sort());
  assert.deepEqual(Object.keys(data.items).sort(),Object.keys(names).sort());
  for(const [key,value] of Object.entries(data.ui)){
    assert(value.trim(),`${code}: missing ${key}`);
    assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),[...key.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),`${code}: changed placeholder ${key}`);
  }
  assert.equal(validLocale(code),code);
  assert(translate(data,'{name} (Included)',{name:'My 日本語 World'}).includes('My 日本語 World'));
  assert(translate(data,'Loaded {count} textures',{count:42}).includes('42'));
  assert.equal(translate(data,'untranslated/path.mca'),'untranslated/path.mca');
}
assert.equal(validLocale('../invalid'),'en');assert.equal(validLocale(null),'en');
assert.equal(catalogs.en.items.stone,'Stone');assert.equal(catalogs.ja.items.stone,'石');assert.equal(catalogs['zh-CN'].items.stone,'石头');assert.equal(catalogs['zh-TW'].items.stone,'石頭');assert.equal(catalogs.ko.items.stone,'돌');
const markup=await readFile('src/ui/menus.html','utf8');
const times=[...markup.matchAll(/data-time="(\d+)"[^>]*><span>([^<]+)<\/span> \((\d\d:\d\d)\)/g)];
assert.deepEqual(times.map(m=>[Number(m[1]),m[2],m[3]]),[[1000,'Day','07:00'],[6000,'Noon','12:00'],[13000,'Night','19:00'],[18000,'Midnight','00:00']]);
for(const [,ticks,,caption] of times)assert.equal(`${String(Math.floor((Number(ticks)+6000)%24000/1000)).padStart(2,'0')}:00`,caption);
console.log('Five language catalogs, official item names, placeholders and time presets passed.');

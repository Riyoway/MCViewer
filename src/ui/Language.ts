export const languages=[['en','English (US)'],['ja','日本語 (日本)'],['zh-CN','简体中文 (中国)'],['zh-TW','繁體中文 (台灣)'],['ko','한국어 (대한민국)']] as const;
export type Locale=typeof languages[number][0];
export interface Catalog {ui:Record<string,string>;items:Record<string,string>}
export function validLocale(value:unknown):Locale{return languages.some(([code])=>code===value)?value as Locale:'en';}
export function translate(catalog:Catalog,key:string,params:Record<string,string|number>={}){
  return (catalog.ui[key]??key).replace(/\{(\w+)\}/g,(match,name)=>String(params[name]??match));
}
let current:Locale='en',catalog:Catalog={ui:{},items:{}},generation=0;
const cached=new Map<Locale,Promise<Catalog>>();
export function locale(){return current;}
export function itemNames(){return catalog.items;}
export function t(key:string,params?:Record<string,string|number>){return translate(catalog,key,params);}
export async function loadLanguage(code:Locale){
  const token=++generation;
  let request=cached.get(code);
  if(!request){request=fetch(`${import.meta.env.BASE_URL}menu/locales/${code}.json`).then(async response=>{if(!response.ok)throw new Error('Unable to load language.');return await response.json() as Catalog;});cached.set(code,request);request.catch(()=>cached.delete(code));}
  const data=await request;if(token!==generation)return false;
  current=code;catalog=data;document.documentElement.lang=code;
  try{localStorage.setItem('viewer-language',code);}catch{/* storage may be unavailable */}
  return true;
}
export function savedLanguage():Locale{try{return validLocale(localStorage.getItem('viewer-language'));}catch{return 'en';}}
export function setText(element:HTMLElement,key:string,params?:Record<string,string|number>){
  element.dataset.i18n=key;if(params)element.dataset.i18nParams=JSON.stringify(params);else delete element.dataset.i18nParams;
  const text=t(key,params);if(element.textContent!==text)element.textContent=text;
}
export function setLiteral(element:HTMLElement,text:string){delete element.dataset.i18n;delete element.dataset.i18nParams;delete element.dataset.i18nMessage;if(element.textContent!==text||element.querySelector('[data-i18n],[data-i18n-message]'))element.textContent=text;}
export function message(text:string){
  if(catalog.ui[text])return t(text);
  const loaded=text.match(/^Loaded (\d+) textures$/);if(loaded)return t('Loaded {count} textures',{count:loaded[1]});
  for(const key of Object.keys(catalog.ui).sort((a,b)=>b.length-a.length))if(text.startsWith(key+': ')||text.startsWith(key+' '))return t(key)+text.slice(key.length);
  return text;
}
export function setMessage(element:HTMLElement,text:string){setLiteral(element,message(text));element.dataset.i18nMessage=text;}
// Bind source text once, before the bitmap renderer replaces text nodes. User files/names
// are written with setLiteral, so changing the language never rewrites user content.
export function bindLanguage(root:HTMLElement){
  for(const element of root.querySelectorAll<HTMLElement>('[aria-label],[title]'))for(const attr of ['aria-label','title']){const value=element.getAttribute(attr);if(value&&catalog.ui[value])element.setAttribute('data-i18n-'+attr,value);}
  for(const label of root.querySelectorAll<HTMLElement>('label:has(select),label:has(input[type=checkbox])'))label.dataset.optionName=[...label.childNodes].filter(node=>!(node instanceof HTMLElement&&node.matches('select,input'))).map(node=>node.textContent).join('').trim();
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
  for(const node of nodes){const parent=node.parentElement;if(!parent||parent.closest('script,style,output,input,textarea,.no-bitmap,.mc-text,[data-i18n]'))continue;
    const source=node.textContent??'',key=source.trim().replace(/:$/,'');if(!catalog.ui[key])continue;
    if(parent.tagName==='OPTION'){parent.dataset.i18n=key;continue;}
    const span=document.createElement('span');span.dataset.i18n=key;
    const start=source.indexOf(key);span.dataset.i18nBefore=source.slice(0,start);span.dataset.i18nAfter=source.slice(start+key.length);span.textContent=source;node.replaceWith(span);
  }
  renderLanguage(root);
}
export function renderLanguage(root:HTMLElement){
  const elements=[root,...root.querySelectorAll<HTMLElement>('*')];
  for(const element of elements){
    if(element.dataset.i18n){const text=(element.dataset.i18nBefore??'')+t(element.dataset.i18n,JSON.parse(element.dataset.i18nParams??'{}'))+(element.dataset.i18nAfter??'');if(element.textContent!==text)element.textContent=text;}
    if(element.dataset.i18nMessage)element.textContent=message(element.dataset.i18nMessage);
    for(const attr of ['aria-label','title']){const key=element.getAttribute('data-i18n-'+attr);if(key)element.setAttribute(attr,t(key));}
  }
}

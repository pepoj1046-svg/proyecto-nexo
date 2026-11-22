// 5A.5 interface preferences. They live only in this browser (localStorage), carry no
// personal data and never reach the server. Storage can be unavailable or corrupt:
// every access is guarded and falls back to the defaults.
export type Preferences={largeText:boolean;highContrast:boolean;reduceMotion:boolean};
export const PREFERENCES_KEY='nexo.lab.preferences.v1';
export const defaults:Preferences={largeText:false,highContrast:false,reduceMotion:false};
const CLASSES:Record<keyof Preferences,string>={largeText:'pref-large-text',highContrast:'pref-high-contrast',reduceMotion:'pref-reduce-motion'};

export function parsePreferences(raw:string|null):Preferences{
 try{
  const v=raw?JSON.parse(raw):null;
  if(!v||typeof v!=='object'||Array.isArray(v))return{...defaults};
  return{largeText:v.largeText===true,highContrast:v.highContrast===true,reduceMotion:v.reduceMotion===true};
 }catch{return{...defaults};}
}
export function loadPreferences():Preferences{try{return parsePreferences(localStorage.getItem(PREFERENCES_KEY));}catch{return{...defaults};}}
export function applyPreferences(p:Preferences,root:{classList:{toggle:(c:string,on:boolean)=>unknown}}=document.documentElement){
 for(const k of Object.keys(CLASSES)as(keyof Preferences)[])root.classList.toggle(CLASSES[k],p[k]);
}
// Returns false when the browser refused to keep the choice; it still applies now.
export function savePreferences(p:Preferences):boolean{
 applyPreferences(p);
 try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify(p));return true;}catch{return false;}
}

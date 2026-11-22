// Etapa 6A. Delivery channels for notices. Only the in-app simulated channel exists;
// every external channel (SMS, e-mail, push, voice) is declared so a future provider
// has a fixed contract, but refuses until the owner authorizes a provider, consent and
// privacy terms (P-6A-2). Nothing here performs network I/O.
export const CHANNELS=Object.freeze({
 IN_APP_SIMULATED:Object.freeze({enabled:true,external:false}),
 SMS:Object.freeze({enabled:false,external:true}),
 EMAIL:Object.freeze({enabled:false,external:true}),
 PUSH:Object.freeze({enabled:false,external:true}),
 VOICE:Object.freeze({enabled:false,external:true}),
});
// Contract for a future real provider: deliver(notice) must be idempotent by notice id,
// must not retry past expiresAt, must report FAILED without throwing away the notice and
// must only be called for users who consented to that channel.
export function channel(name){
 const c=CHANNELS[name];
 if(!c)throw new Error('UNKNOWN_CHANNEL');
 return Object.freeze({name,...c,deliver:async notice=>{
  if(!c.enabled)throw new Error('CHANNEL_NOT_ENABLED');
  if(!notice||typeof notice.id!=='string')throw new Error('INVALID_NOTICE');
  if(Date.parse(notice.expiresAt)<=Date.now())return{id:notice.id,status:'EXPIRED'};
  return{id:notice.id,status:'STORED_IN_APP'};
 }});
}

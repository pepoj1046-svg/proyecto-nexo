import {useSyncExternalStore} from 'react';

// Memory only: an uncertain administrative POST must keep its mounted form,
// body, account and receipt key. This is a recovery aid, never authorization.
const locks=new Set<symbol>(),reservationLocks=new Set<symbol>(),recovery=new Map<symbol,string>(),listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const adminIntentPending=()=>locks.size>0;
export const reservationIntentPending=()=>reservationLocks.size>0;
export const protectReservationIntent=(token:symbol,pending:boolean)=>protectAdminIntent(token,pending,true);
export function protectAdminIntent(token:symbol,pending:boolean,reservation=false){
 const previous=locks.has(token);if(previous===pending)return;
 if(pending){locks.add(token);if(reservation)reservationLocks.add(token);}else{locks.delete(token);reservationLocks.delete(token);recovery.delete(token);}
 for(const listener of listeners)listener();
}
export const useAdminIntent=()=>useSyncExternalStore(subscribe,adminIntentPending,()=>false);
export function requestAdminAuthentication(token:symbol,account:string){
 recovery.set(token,account);for(const listener of listeners)listener();
}
export function completeAdminAuthentication(account:string){
 for(const[token,expected]of recovery)if(expected===account)recovery.delete(token);
 for(const listener of listeners)listener();
}
export const useAdminRecovery=()=>useSyncExternalStore(subscribe,()=>recovery.values().next().value??null,()=>null);

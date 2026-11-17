import{currentSession,privateApi,subscribeSession,suspendDocument}from'./private-api';
import type{WebSession}from'./private-api';
import{RecoveryStore}from'./recovery-consult';
import type{CurrentPage}from'./recovery-consult';
import{acknowledgeRecoveryFault,forgetInvalidRecovery,readRecoveryTickets,retireRecoveryTicket}from'./recovery-ticket';
// One store per document. Only existing read endpoints are reachable from here:
// /api/session, /api/recovery/receipt and /api/reservations/page. There is no
// automatic consultation: online, pageshow, timers and tab changes do nothing.
export const recoveryStore=new RecoveryStore({
 session:()=>privateApi<WebSession>('/api/session'),
 receipt:(s,ticket)=>privateApi('/api/recovery/receipt',{v:1,ticket},s.csrf),
 page:(s,cursor)=>privateApi<CurrentPage>('/api/reservations/page',{limit:50,cursor},s.csrf),
 retire:retireRecoveryTicket,forget:forgetInvalidRecovery,acknowledge:acknowledgeRecoveryFault,
 // A revoked or changed context returns to the B1 gate, which requires the original account.
 reauthenticate:()=>suspendDocument(),
 now:()=>Date.now()
});
const sync=()=>{const s=currentSession();recoveryStore.sync(s,readRecoveryTickets(s));};
subscribeSession(sync);sync();

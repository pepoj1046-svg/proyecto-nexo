import { createBusinessService } from '../db/business-service.mjs';
import { assertRuntime } from '../db/runtime.mjs';
import { object,terminalInput,assignmentInput } from '../domain/business.mjs';
import { startLocalTransport } from './local-transport.mjs';

// Business-only listener: no identity, registration, SQL or provisioning pool.
export async function startBusinessRuntime(pool) {
  const c=await pool.connect();
  try {await assertRuntime(c,'nexo_app',{localTest:true});} finally {c.release();}
  const service=createBusinessService(pool);
  const route=(keys,fn)=>async(body,token,key)=>{object(body,keys);return [200,await fn(token,key,body)];};
  const terminal=(op,fn)=>async(body,token,key)=>{terminalInput(op,body);return [200,await fn(token,key,body)];};
  const assignment=(op,fn)=>async(body,token,key)=>{assignmentInput(op,body);return [200,await fn(token,key,body)];};
  return startLocalTransport({localTest:true,allProtected:true,mutations:[
    '/business/reserve','/business/walk-in','/business/respond','/business/cancel',
    '/business/depart','/business/progress','/business/request-queue','/business/movement',
    '/business/member-movement','/business/absence-draft','/business/refresh-offers',
    '/business/terminal-command','/business/terminal-config','/business/transfer',
    '/business/correct-arrival','/business/assignment-transfer','/business/assignment-respond','/business/episode-command'
  ],routes:{
    '/business/assignment-status':assignment('status',(t,_k,b)=>service.assignmentStatus(t,b.bookingId)),
    '/business/terminal-history':assignment('history',(t,_k,b)=>service.terminalHistory(t,b)),
    '/business/recovery-queue':assignment('queue',(t,_k,b)=>service.recoveryQueue(t,b)),
    '/business/correct-arrival':assignment('correction',(t,k,b)=>service.correctArrival(t,k,b.bookingId,b.episode,b.eventId,b.reason)),
    '/business/assignment-transfer':assignment('transfer',(t,k,b)=>service.transferAssignment(t,k,b.bookingId,b.targetTripId,b.direction,b.episode)),
    '/business/assignment-respond':assignment('respond',(t,k,b)=>service.respondAssignment(t,k,b.bookingId,b.episode,b.accept)),
    '/business/episode-command':assignment('command',(t,k,b)=>service.episodeCommand(t,k,b.bookingId,b.command,b.confirmed,b.episode)),
    '/business/advancement-candidates':terminal('advancement',(t,_k,b)=>service.advancementCandidates(t,b.tripId)),
    '/business/terminal-command':terminal('command',(t,k,b)=>service.terminalCommand(t,k,b.bookingId,b.command,b.confirmed)),
    '/business/terminal-config':terminal('config',(t,k,b)=>service.configureTerminal(t,k,b.associationId,b.declarationSeconds)),
    '/business/terminal-evaluation':terminal('evaluation',(t,_k,b)=>service.terminalEvaluation(t,b.bookingId)),
    '/business/transfer-candidates':terminal('candidates',(t,_k,b)=>service.transferCandidates(t,b.bookingId,b.direction)),
    '/business/transfer':terminal('transfer',(t,k,b)=>service.transferBooking(t,k,b.bookingId,b.targetTripId,b.direction)),
    '/business/roster':route(['bookingId'],(t,_k,b)=>service.roster(t,b.bookingId)),
    '/business/member-movement':route(['memberId','kind'],(t,k,b)=>service.memberMovement(t,k,b.memberId,b.kind)),
    '/business/absence-draft':route(['memberId','kind'],(t,k,b)=>service.absenceDraft(t,k,b.memberId,b.kind)),
    '/business/absence-preview':route(['memberId'],(t,_k,b)=>service.absencePreview(t,b.memberId)),
    '/business/offers':route(['tripId','limit','offset'],(t,_k,b)=>service.offers(t,b)),
    '/business/refresh-offers':route(['tripId'],(t,k,b)=>service.refreshOffers(t,k,b.tripId)),
    '/business/quote':route(['routeId','from','to','seats','express'],(t,_k,b)=>service.quote(t,b)),
    '/business/reserve':route(['routeId','from','to','seats','express','parts','splitConsent','containsMinors','quote'],(t,k,b)=>service.reserve(t,k,b)),
    '/business/walk-in':route(['routeId','from','to','seats','express','parts','splitConsent','containsMinors','quote'],(t,k,b)=>service.walkIn(t,k,b)),
    '/business/booking':route(['bookingId'],(t,_k,b)=>service.booking(t,b.bookingId)),
    '/business/queue':route(['routeId','limit','offset'],(t,_k,b)=>service.queue(t,b)),
    '/business/manifest':route(['tripId','limit','offset'],(t,_k,b)=>service.manifest(t,b)),
    '/business/respond':route(['bookingId','accept'],(t,k,b)=>service.respond(t,k,b.bookingId,b.accept)),
    '/business/cancel':route(['bookingId'],(t,k,b)=>service.cancel(t,k,b.bookingId)),
    '/business/depart':route(['tripId'],(t,k,b)=>service.depart(t,k,b.tripId)),
    '/business/progress':route(['tripId','stop'],(t,k,b)=>service.progress(t,k,b.tripId,b.stop)),
    '/business/request-queue':route(['previousTripId','routeId'],(t,k,b)=>service.requestQueue(t,k,b.previousTripId,b.routeId)),
    '/business/movement':route(['bookingId','kind'],(t,k,b)=>service.movement(t,k,b.bookingId,b.kind))
  }});
}

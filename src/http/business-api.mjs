import { createBusinessService } from '../db/business-service.mjs';
import { assertRuntime } from '../db/runtime.mjs';
import { object,terminalInput,assignmentInput,operationalInput } from '../domain/business.mjs';
import { startLocalTransport } from './local-transport.mjs';

// Business-only listener: no identity, registration, SQL or provisioning pool.
export async function startBusinessRuntime(pool) {
  const c=await pool.connect();
  try {await assertRuntime(c,'nexo_app',{localTest:true});} finally {c.release();}
  const service=createBusinessService(pool);
  const route=(keys,fn)=>async(body,token,key)=>{object(body,keys);return [200,await fn(token,key,body)];};
  const terminal=(op,fn)=>async(body,token,key)=>{terminalInput(op,body);return [200,await fn(token,key,body)];};
  const assignment=(op,fn)=>async(body,token,key)=>{assignmentInput(op,body);return [200,await fn(token,key,body)];};
  const operational=(op,fn)=>async(body,token,key)=>{operationalInput(op,body);return [200,await fn(token,key,body)];};
  return startLocalTransport({localTest:true,allProtected:true,mutations:[
    '/business/reserve','/business/walk-in','/business/respond','/business/cancel',
    '/business/depart','/business/progress','/business/request-queue','/business/movement',
    '/business/member-movement','/business/absence-draft','/business/refresh-offers',
    '/business/terminal-command','/business/terminal-config','/business/transfer',
    '/business/correct-arrival','/business/assignment-transfer','/business/assignment-respond','/business/episode-command',
    '/business/terminal-impediment','/business/register-responsible','/business/group-consent','/business/approve-terminal-transfer','/business/simulate-payment','/business/activate-terminal','/business/terminal-arrival','/business/terminal-observation','/business/correct-movement','/business/begin-urban','/business/fleet-command','/business/restore-vehicle'
  ],routes:{
    '/business/terminal-impediment':operational('impediment',(t,k,b)=>service.terminalImpediment(t,k,b.tripId,b.command,b.reason,b.confirmed)),
    '/business/fleet-history':operational('history',(t,_k,b)=>service.fleetHistory(t,b)),
    '/business/operational-status':operational('status',(t,_k,b)=>service.operationalStatus(t,b.tripId)),
    '/business/group-status':operational('booking',(t,_k,b)=>service.groupStatus(t,b.bookingId)),
    '/business/register-responsible':operational('responsible',(t,k,b)=>service.registerResponsible(t,k,b.bookingId,b.responsibleId,b.confirmed)),
    '/business/group-consent':operational('consent',(t,k,b)=>service.consentGroup(t,k,b.bookingId,b.targetTripId,b.episode,b.confirmed)),
    '/business/approve-terminal-transfer':operational('approve',(t,k,b)=>service.approveTerminalTransfer(t,k,b.consentId)),
    '/business/simulate-payment':operational('payment',(t,k,b)=>service.simulatePayment(t,k,b.bookingId,b.state,b.confirmed)),
    '/business/activate-terminal':operational('booking',(t,k,b)=>service.activateTerminal(t,k,b.bookingId)),
    '/business/terminal-arrival':operational('arrival',(t,k,b)=>service.terminalArrival(t,k,b.bookingId,b.episode,b.confirmed)),
    '/business/terminal-observation':operational('observation',(t,k,b)=>service.terminalObservation(t,k,b.bookingId,b.memberId??null,b.kind,b.seats,b.destination,b.confirmed)),
    '/business/correct-movement':operational('correction',(t,k,b)=>service.correctMovement(t,k,b.bookingId,b.factKey,b.reason,b.confirmed)),
    '/business/movement-history':operational('booking',(t,_k,b)=>service.movementHistory(t,b.bookingId)),
    '/business/begin-urban':operational('urban',(t,k,b)=>service.beginUrban(t,k,b.tripId,b.mainStop,b.confirmed)),
    '/business/fleet-command':operational('fleet',(t,k,b)=>service.fleetCommand(t,k,b.tripId,b.version,b.command,b.targetTripId??null,b.onboard??null,b.confirmed)),
    '/business/free-replacement':operational('replacement',(t,_k,b)=>service.freeReplacement(t,b.incidentId)),
    '/business/restore-vehicle':operational('restore',(t,k,b)=>service.restoreVehicle(t,k,b.vehicleId,b.confirmed)),
    '/business/notices':operational('notices',(t)=>service.notices(t)),
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

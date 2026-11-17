import { object,id,page } from './business.mjs';

export const closureFields=Object.freeze({
  'public-availability':['originLocalityId','destinationLocalityId','seats'],
  'route-condition':['routeId','state','reason','description','affectedStops','fareId','amountBOB','confirmed'],
  'condition-decision':['bookingId','revision','decision','confirmed'],
  'minor-review':['memberId','kind','companionId','result','confirmed'],
  'terminal-replacement':['incidentId'],
  'terminal-reassign':['incidentId','targetTripId','consentIds','safeTransfer','confirmed'],
  'road-candidates':['incidentId','priority'],
  'road-command':['tripId','version','command','targetTripId','priority','onboard','confirmed'],
  'reserve-enroute':['tripId','routeId','from','to','seats','quote'],
  'walk-in-enroute':['tripId','routeId','from','to','seats','quote'],
  'association-review':['associationId','state','confirmed'],
  'association-contact':['associationId','contactCode','confirmed'],
  'passenger-decision':['bookingId','decision','confirmed'],
  'late-resolution':['bookingId','targetTripId','cancelOnly','confirmed'],
  'resolution-options':['bookingId'],
  'operating-history':['routeId','limit','offset']
});
const optionalIds=new Set(['fareId','companionId','targetTripId']);
const oneOf=(value,values)=>{if(!values.includes(value))throw new Error('INVALID_CLOSURE_COMMAND');};
export function closureInput(operation,b) {
  const fields=closureFields[operation];if(!fields)throw new Error('INVALID_OPERATION');object(b,fields);
  for(const f of fields.filter(k=>k.endsWith('Id'))) {
    if(optionalIds.has(f)&&b[f]===undefined)continue;
    id(b[f]);
  }
  if(fields.includes('confirmed')&&b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
  if(fields.includes('priority')&&b.priority!==undefined)oneOf(b.priority,['ORIGIN','DESTINATION']);
  if(operation==='public-availability'&&(!Number.isInteger(b.seats??1)||(b.seats??1)<1||(b.seats??1)>6))throw new Error('INVALID_SEATS');
  if(operation==='route-condition') {
    oneOf(b.state,['NORMAL','DESVIO','SUSPENDIDA']);oneOf(b.reason,['NORMAL','BLOCKADE','STRIKE','LANDSLIDE','OTHER_DECLARED']);
    if(typeof b.description!=='string'||b.description.length>500||!Array.isArray(b.affectedStops)||b.affectedStops.length>100||b.affectedStops.some(x=>!Number.isInteger(x)||x<0||x>10000)||new Set(b.affectedStops).size!==b.affectedStops.length||
      ('fareId' in b)!==('amountBOB' in b)||('amountBOB' in b&&(typeof b.amountBOB!=='string'||!/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(b.amountBOB))))throw new Error('INVALID_ROUTE_CONDITION');
  }
  if(operation==='condition-decision') {
    oneOf(b.decision,['ACCEPT','ADMIN_REVIEW']);if(!Number.isInteger(b.revision)||b.revision<1)throw new Error('INVALID_REVISION');
  }
  if(operation==='minor-review') {
    oneOf(b.kind,['PARENT_ACCOMPANIED','AUTHORIZED_COMPANION','UNACCOMPANIED']);oneOf(b.result,['PENDING','VERIFIED_SIMULATED','REJECTED']);
    if((b.kind==='UNACCOMPANIED')!==(!('companionId' in b)))throw new Error('INVALID_COMPANION');
  }
  if(operation==='terminal-reassign') {
    id(b.targetTripId);
    if(typeof b.safeTransfer!=='boolean'||!Array.isArray(b.consentIds)||b.consentIds.length<1||b.consentIds.length>50||new Set(b.consentIds).size!==b.consentIds.length)throw new Error('INVALID_REASSIGNMENT');
    b.consentIds.forEach(id);
  }
  if(operation==='road-command') {
    oneOf(b.command,['REPORT','CONFIRM','ASSIGN','SAFE_TRANSFER','ESCALATE']);
    if(!Number.isInteger(b.version)||b.version<0||b.version>2147483647)throw new Error('INVALID_VERSION');
    if(b.command==='ASSIGN'){id(b.targetTripId);oneOf(b.priority,['ORIGIN','DESTINATION']);}
    else if('targetTripId' in b||'priority' in b)throw new Error('INVALID_REQUEST');
    if(b.command==='SAFE_TRANSFER'){if(!Number.isInteger(b.onboard)||b.onboard<0||b.onboard>6)throw new Error('INVALID_ONBOARD');}
    else if('onboard' in b)throw new Error('INVALID_REQUEST');
  }
  if(['reserve-enroute','walk-in-enroute'].includes(operation)) {
    if(!Number.isInteger(b.from)||!Number.isInteger(b.to)||b.from<0||b.to<=b.from||b.to>10000||!Number.isInteger(b.seats)||b.seats<1||b.seats>6)throw new Error('INVALID_SEGMENT');
    if('quote' in b){object(b.quote,['fareId','fareVersion','totalBOB']);id(b.quote.fareId);
      if(!Number.isInteger(b.quote.fareVersion)||b.quote.fareVersion<1||typeof b.quote.totalBOB!=='string'||!/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(b.quote.totalBOB))throw new Error('INVALID_QUOTE');}
  }
  if(operation==='association-review')oneOf(b.state,['PENDING','ACTIVE','SUSPENDED']);
  if(operation==='association-contact'&&(typeof b.contactCode!=='string'||!/^LAB-[A-Z0-9_-]{1,40}$/.test(b.contactCode)))throw new Error('INVALID_SYNTHETIC_CONTACT');
  if(operation==='passenger-decision')oneOf(b.decision,['REQUEST_ALTERNATIVE','CANCEL_REQUEST','REFUND_CONTACT_REQUESTED']);
  if(operation==='late-resolution'&&(typeof b.cancelOnly!=='boolean'||b.cancelOnly!==(!('targetTripId' in b))))throw new Error('INVALID_LATE_RESOLUTION');
  if(operation==='operating-history')page(b,'routeId');
  return b;
}
export const closureReadOperations=['public-availability','terminal-replacement','road-candidates','resolution-options','operating-history'];

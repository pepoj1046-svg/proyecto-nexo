const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function object(value,keys) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))
    throw new Error('INVALID_REQUEST');
  return value;
}
export function id(value) {if(typeof value!=='string' || !uuid.test(value))throw new Error('INVALID_ID');return value;}
export function actionKey(value) {
  if(typeof value!=='string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))throw new Error('INVALID_ACTION_KEY');
  return value;
}
export function segment(request) {
  const {routeId,from,to,seats,express=false}=request;
  id(routeId);
  if(!Number.isInteger(from) || !Number.isInteger(to) || from<0 || to<=from || to>10000 ||
    !Number.isInteger(seats) || seats<1 || seats>6 || typeof express!=='boolean' || (express && seats!==6))
    throw new Error('INVALID_SEGMENT');
  return {routeId,from,to,seats,express};
}
export function validateReservation(request) {
  object(request,['routeId','from','to','seats','express','parts','splitConsent','containsMinors','quote']);
  const p=segment(request);
  for(const k of ['splitConsent','containsMinors']) if(k in request) {
    if(typeof request[k]!=='boolean')throw new Error('INVALID_REQUEST');p[k]=request[k];
  }
  if('parts' in request) {
    if(!Array.isArray(request.parts) || request.parts.length<1 || request.parts.length>6)throw new Error('INVALID_PARTS');
    p.parts=request.parts.map(part=>{
      object(part,['tripId','seats']);id(part.tripId);
      if(!Number.isInteger(part.seats) || part.seats<1 || part.seats>6)throw new Error('INVALID_PARTS');
      return {tripId:part.tripId,seats:part.seats};
    });
    if(new Set(p.parts.map(x=>x.tripId.toLowerCase())).size!==p.parts.length || p.parts.reduce((n,x)=>n+x.seats,0)!==p.seats)
      throw new Error('INVALID_PARTS');
    if(p.parts.length>1 && (p.seats<3 || p.express || p.splitConsent!==true || p.containsMinors!==false))
      throw new Error('SPLIT_NOT_ALLOWED');
  }
  let quote=null;
  if('quote' in request) {
    quote=object(request.quote,['fareId','fareVersion','totalBOB','currency']);id(quote.fareId);
    if(!Number.isInteger(quote.fareVersion) || quote.fareVersion<1 || quote.fareVersion>2147483647 || typeof quote.totalBOB!=='string' ||
      !/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(quote.totalBOB) ||
      ('currency' in quote && quote.currency!=='BOB'))throw new Error('INVALID_QUOTE');
    quote={fareId:quote.fareId,fareVersion:quote.fareVersion,totalBOB:quote.totalBOB};
  }
  return {request:p,quote};
}
export function page(request,key) {
  object(request,[key,'limit','offset']);id(request[key]);
  const {limit=50,offset=0}=request;
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('INVALID_PAGE');
  return {...request,limit,offset};
}

export function memberCommand(request,kinds) {
  object(request,['memberId','kind']);id(request.memberId);
  if(!kinds.includes(request.kind))throw new Error('INVALID_MEMBER_COMMAND');
  return request;
}

export function terminalInput(operation,b) {
 const fields={command:['bookingId','command','confirmed'],config:['associationId','declarationSeconds'],evaluation:['bookingId'],candidates:['bookingId','direction'],transfer:['bookingId','targetTripId','direction'],advancement:['tripId']}[operation];
 object(b,fields);
 for(const field of fields.filter(f=>f.endsWith('Id')))id(b[field]);
 if(fields.includes('direction') && !['LATER','EARLIER'].includes(b.direction))throw new Error('INVALID_DIRECTION');
 if(operation==='command' && (b.confirmed!==true || !['DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED'].includes(b.command)))throw new Error('INVALID_TERMINAL_COMMAND');
 if(operation==='config' && (!Number.isInteger(b.declarationSeconds)||b.declarationSeconds<1||b.declarationSeconds>86400))throw new Error('INVALID_DURATION');
 return b;
}

export function assignmentInput(operation,b) {
 const fields={status:['bookingId'],history:['bookingId','limit','offset'],queue:['routeId','limit','offset'],correction:['bookingId','episode','eventId','reason'],transfer:['bookingId','targetTripId','direction','episode'],respond:['bookingId','episode','accept'],command:['bookingId','command','confirmed','episode']}[operation];
 object(b,fields);
 for(const field of fields.filter(f=>f.endsWith('Id')))id(b[field]);
 if(fields.includes('episode') && (!Number.isInteger(b.episode)||b.episode<0||b.episode>8))throw new Error('INVALID_EPISODE');
 if(operation==='correction' && !['OPERATOR_ERROR','WRONG_RESERVATION','PASSENGER_CORRECTION'].includes(b.reason))throw new Error('INVALID_CORRECTION');
 if(operation==='transfer' && !['LATER','EARLIER','RECOVER'].includes(b.direction))throw new Error('INVALID_DIRECTION');
 if(operation==='respond' && typeof b.accept!=='boolean')throw new Error('INVALID_RESPONSE');
 if(operation==='command')terminalInput('command',{bookingId:b.bookingId,command:b.command,confirmed:b.confirmed});
 if(operation==='history')page(b,'bookingId');
 if(operation==='queue')page(b,'routeId');
 return b;
}

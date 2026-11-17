export type RouteState='NORMAL'|'DESVIO'|'SUSPENDIDA';
export interface Locality {localityId:string;name:string;municipality:string;province:string;department:string;catalogId:string;catalogVersion:string}
export interface Segment {segment:number;reserved:number;confirmed:number;available:number;fromName:string;toName:string}
export interface Service {associationId:string;association:string;routeId:string;route:string;state:RouteState;reason:string;alternateDescription:string;affectedStops:number[];updatedAt:string|null;conditionRevision:number;contactCode:string|null;contactIsSynthetic:boolean;from:number;to:number;tripId:string|null;position:number|null;tripState:string|null;newReservationsAllowed:boolean;confirmedSeats:number;availableSeats:number;missingToSix:number;segments:Segment[];fareBOB:string|null;fareVersion:number|null;currency:'BOB';departureTimePromised:false;boardingName:string;alightingName:string;terminalReference:string|null}
export interface Availability {services:Service[];asOf:string;mode:'LOCAL_LAB';reservationWritesEnabled:false;snapshotOnly:true}
export interface Selection {service:Service;origin:Locality;destination:Locality;asOf:string}
export function groupServices(services:Service[]) {
  const groups=new Map<string,{id:string;name:string;services:Service[]}>();
  for(const s of services){const group=groups.get(s.associationId)??{id:s.associationId,name:s.association,services:[]};group.services.push(s);groups.set(s.associationId,group);}
  return [...groups.values()].sort((a,b)=>Number(b.services.some(s=>eligibleSeats(s)>0))-Number(a.services.some(s=>eligibleSeats(s)>0))||a.name.localeCompare(b.name,'es'));
}
export function eligibleSeats(service:Service) {
  if(!service.newReservationsAllowed||service.state==='SUSPENDIDA'||!service.tripId||service.fareBOB===null||!service.segments.length)return 0;
  return Math.max(0,Math.min(6,service.availableSeats,...service.segments.map(s=>s.available)));
}
export function seatStates(segment:Segment) {
  return Array.from({length:6},(_,i)=>i<segment.confirmed?'confirmed':i<segment.reserved?'held':i<segment.reserved+segment.available?'free':'blocked');
}
export function totalFare(price:string|null,seats:number):string|null {
  if(price===null||!/^\d{1,10}\.\d{2}$/.test(price)||!Number.isInteger(seats)||seats<1||seats>6)return null;
  const [whole,decimal]=price.split('.'),cents=(Number(whole)*100+Number(decimal))*seats;
  return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}
export const money=(value:string|null)=>value===null?'Tarifa por confirmar':`Bs ${new Intl.NumberFormat('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value))}`;
export const stateLabels:Record<RouteState,string>={NORMAL:'Operación normal',DESVIO:'Desvío informado',SUSPENDIDA:'Salidas suspendidas'};

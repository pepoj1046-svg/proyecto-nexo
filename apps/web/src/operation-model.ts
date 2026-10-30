export interface OperationPoint{id:string;order:number;name:string;kind:string;boardingAllowed:boolean;alightingAllowed:boolean}
export interface OperationBooking{bookingId:string;source:string;seats:number;status:string;effectiveStatus:string;priceBOB:string;boardingPointId:string;alightingPointId:string;boardingName:string;alightingName:string;episode:number;presence:{declarationRecorded?:boolean;declaredActive:boolean;verified:boolean;boarded:boolean;pickupRequested:boolean;pickupArrived:string|null};movementMode:'NONE'|'GROUP'|'INDIVIDUAL';movements:{kind:string;pointId:string}[];members:{memberId:string;ordinal:number;boarded:boolean;alighted:boolean}[]}
export interface TripSnapshot{tripId:string;routeId:string;route:string;association:string;vehicleLabel:string;status:string;phase:string;version:number;currentPointId:string;mainPointId:string|null;points:OperationPoint[];segments:{fromName:string;toName:string;reserved:number;confirmed:number;available:number}[];confirmedSeats:number;committedSeats:number;heldSeats:number;observedOnboard:number;departureEligible:boolean;collectionEligible:boolean;operationAllowed:boolean;incident:null|{state:string;context:string;reason:string;roadVersion:number|null};bookings:OperationBooking[];bookingLimit:number;total:number;nextCursor:Record<string,unknown>|null}
export function operationalLabel(s:Pick<TripSnapshot,'status'|'phase'|'departureEligible'|'confirmedSeats'|'operationAllowed'>){
 if(s.status==='COMPLETED')return'Viaje finalizado';
 if(!s.operationAllowed)return'Incidencia operativa · revisión requerida';
 if(s.status==='WITHDRAWN')return'Fuera de la fila';
 if(s.status==='QUEUED')return s.departureEligible?(s.confirmedSeats===6?'Completo, listo para salir':'Compromisos completos, salida pendiente'):'En fila';
 if(s.phase==='URBAN_COLLECTION')return'Recogiendo pasajeros';
 if(s.phase==='MAIN_TRIP')return'En viaje hacia el destino';
 return'En recorrido';
}
export function presenceLabel(p:OperationBooking['presence']){return p.boarded?'Con abordaje registrado':p.verified?'Llegada verificada presencialmente':p.declaredActive?'Ya llegué: declaración vigente':p.declarationRecorded?'Declaración vencida o retirada: solicita verificación presencial':p.pickupArrived?'Chofer en el punto de recogida':p.pickupRequested?'Recogida solicitada en punto autorizado':'Sin presencia vigente registrada';}

// 5A.6 Ayuda contextual local y versionada. Se entrega con la página: se lee sin red y
// no escribe nada. Describe solo lo que el laboratorio hace de verdad y nunca promete
// comunicaciones, plazos ni asistencia que no existen. Decisión provisional P-5A6-1.
export const HELP_VERSION='2026-11-21.1';
export type HelpRole='PASAJERO'|'CHOFER'|'ADMINISTRACION'|'GENERAL';
export type HelpKind='INFORMACION'|'INCIDENCIA'|'REVISION';
export type HelpTopic={id:string;role:HelpRole;kind:HelpKind;title:string;steps:string[];note?:string;link?:{href:string;label:string}};

export const roleLabels:Record<HelpRole,string>={PASAJERO:'Pasajero',CHOFER:'Chofer',ADMINISTRACION:'Administración',GENERAL:'Para todos'};
export const kindLabels:Record<HelpKind,string>={INFORMACION:'Información',INCIDENCIA:'Incidencia',REVISION:'Requiere revisión'};

export const helpTopics:HelpTopic[]=[
 {id:'buscar-viaje',role:'PASAJERO',kind:'INFORMACION',title:'Buscar un viaje y elegir plazas',steps:[
  'Escribe tu localidad de origen y la de destino; no hace falta elegir una categoría.',
  'Cada asociación muestra sus rutas, el punto de salida y las plazas libres por tramo.',
  'Un trufi lleva como máximo 6 pasajeros a la vez; la disponibilidad cambia según quién sube y baja en cada tramo.',
  'Elegir un viaje todavía no registra nada: la tarifa y las plazas se vuelven a comprobar antes de registrar.'],
  link:{href:'/',label:'Ir a buscar viaje'}},
 {id:'grupo',role:'PASAJERO',kind:'INFORMACION',title:'Viajar en grupo',steps:[
  'Un grupo viaja junto en el mismo trufi.',
  'El sistema no divide un grupo por su cuenta: solo lo hace si lo aceptas expresamente al reservar.'],},
 {id:'reserva-incierta',role:'PASAJERO',kind:'INFORMACION',title:'Si no sabes si tu reserva se registró',steps:[
  'Puede pasar si se corta la conexión o recargas la página justo al enviar.',
  'Inicia sesión con la misma cuenta y busca el recuadro «Operación anterior».',
  'Pulsa «Consultar resultado»: el servidor dirá si registró la reserva.',
  'No envíes una reserva nueva hasta consultarla o descartarla; así evitas reservar dos veces.'],
  note:'Descartar la referencia solo borra esa ayuda de este navegador: no cancela ni libera plazas.',link:{href:'/pasajero',label:'Ir a mis reservas'}},
 {id:'mis-reservas',role:'PASAJERO',kind:'INFORMACION',title:'Consultar mis reservas',steps:[
  'En «Mis reservas» ves recorrido, plazas, importe pactado y estado del viaje.',
  'El importe es el que se pactó al reservar, aunque la tarifa cambie después.'],link:{href:'/pasajero',label:'Ir a mis reservas'}},
 {id:'ya-llegue',role:'PASAJERO',kind:'REVISION',title:'Avisar que ya llegaste al punto de salida',steps:[
  'Usa «Ya llegué» cuando estés en el punto de salida.',
  'Es una declaración tuya: la administración puede verificarla.'],},
 {id:'cancelar',role:'PASAJERO',kind:'REVISION',title:'Cancelar o pedir una alternativa',steps:[
  'Usa «Solicitar cancelación» o «Solicitar alternativa para revisión» en tu reserva.',
  'La solicitud queda pendiente hasta que la administración la revise; no es inmediata.'],},
 {id:'problema-pasajero',role:'PASAJERO',kind:'INCIDENCIA',title:'Reportar un problema en tu viaje',steps:[
  'Usa «Reportar un problema» en la reserva afectada.',
  'Queda registrado para la administración de la asociación.'],
  note:'El laboratorio no envía avisos por SMS, correo ni llamadas: revisa el estado en «Mis reservas».'},
 {id:'menores',role:'PASAJERO',kind:'INFORMACION',title:'Menores de edad',steps:[
  'Si viajan menores, decláralo al reservar.',
  'La asociación aplica sus reglas sobre la persona responsable; el chofer no registra menores en la venta presencial.'],},

 {id:'chofer-viajes',role:'CHOFER',kind:'INFORMACION',title:'Tus viajes y la fila',steps:[
  'En «Chofer» ves los viajes asignados a tu trufi y su lugar en la fila.',
  'Las salidas dependen de la operación: el sistema no promete una hora exacta.'],link:{href:'/chofer',label:'Ir al espacio del chofer'}},
 {id:'chofer-presencial',role:'CHOFER',kind:'INFORMACION',title:'Registrar a un pasajero que llega en persona',steps:[
  'Solo se puede en el horario sin personal que fijó tu asociación.',
  'Solo lo hace el chofer del trufi en turno, en su propio trufi, desde el punto de salida.',
  'No registres menores de edad: avisa a la administración siguiendo el protocolo de tu asociación.',
  'La tarifa y las plazas son las mismas que en cualquier otra reserva.'],link:{href:'/chofer',label:'Ir al espacio del chofer'}},
 {id:'chofer-falla',role:'CHOFER',kind:'INCIDENCIA',title:'Reportar una falla mecánica',steps:[
  'Usa «Reportar falla mecánica» en el viaje afectado.',
  'La administración decide la reasignación o el rescate; el sistema no promete un vehículo de reemplazo si no hay uno apto y libre.'],},

 {id:'admin-horario',role:'ADMINISTRACION',kind:'INFORMACION',title:'Horario sin personal',steps:[
  'Fíjalo en el directorio administrativo, dentro de tu asociación.',
  'Durante ese horario, el chofer en turno puede registrar pasajeros presenciales.',
  'Solo un administrador sin ámbito limitado puede cambiarlo; cada cambio queda auditado.'],link:{href:'/administracion',label:'Ir a administración'}},
 {id:'admin-incidencias',role:'ADMINISTRACION',kind:'INCIDENCIA',title:'Incidencias, reasignaciones y rescates',steps:[
  'Confirma la incidencia reportada antes de reasignar.',
  'Reasigna solo a un vehículo apto, libre y autorizado de tu propia asociación.',
  'Una ausencia no libera plazas por sí sola, y una discrepancia no revierte la custodia automáticamente.'],link:{href:'/administracion',label:'Ir a administración'}},
 {id:'admin-revision',role:'ADMINISTRACION',kind:'REVISION',title:'Solicitudes que esperan tu revisión',steps:[
  'Cancelaciones, alternativas y llegadas declaradas aparecen para tu revisión.',
  'Revisa con los datos del servidor: lo que ve el pasajero en su pantalla no decide.'],},

 {id:'tipos',role:'GENERAL',kind:'INFORMACION',title:'Información, incidencia o revisión',steps:[
  'Información: explica cómo funciona algo; no cambia nada.',
  'Incidencia: algo salió mal en un viaje y queda registrado para la administración.',
  'Requiere revisión: es una solicitud que una persona de la asociación debe aprobar o rechazar.'],},
 {id:'laboratorio',role:'GENERAL',kind:'INFORMACION',title:'Qué no hace este laboratorio',steps:[
  'No cobra ni procesa dinero real.',
  'No usa GPS real ni envía avisos por SMS, correo o llamadas.',
  'Todos los datos son ficticios y desaparecen al reiniciar el laboratorio.'],},
 {id:'preferencias',role:'GENERAL',kind:'INFORMACION',title:'Ajustar el tamaño del texto y el contraste',steps:[
  'En «Mi cuenta» puedes agrandar el texto, aumentar el contraste o reducir las animaciones.',
  'Se guardan solo en este navegador.'],link:{href:'/cuenta',label:'Ir a mi cuenta'}},
];

// Which help a page offers first. Unknown paths show general help.
export function rolesForPath(path:string):HelpRole[]{
 if(path==='/'||path==='/reservar'||path==='/pasajero')return['PASAJERO','GENERAL'];
 if(path==='/chofer'||path==='/operador')return['CHOFER','GENERAL'];
 if(path==='/administracion')return['ADMINISTRACION','GENERAL'];
 return['GENERAL'];
}
export function filterTopics(topics:HelpTopic[],role:HelpRole|'TODOS',query:string):HelpTopic[]{
 const q=query.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g,'');
 const norm=(s:string)=>s.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g,'');
 return topics.filter(t=>(role==='TODOS'||t.role===role)&&(!q||norm([t.title,...t.steps,t.note??''].join(' ')).includes(q)));
}

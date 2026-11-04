import type {useCommands} from './use-command';

export function CommandRecovery({command,onRecovered}:{command:ReturnType<typeof useCommands>;onRecovered?:(result:unknown)=>void}){
 if(!command.busy&&(!command.pending||!command.error))return null;
 return <section className="command-recovery" aria-label="Recuperar actuación pendiente" aria-busy={command.busy}>
  <p role="status">{command.busy?(command.received?'Recibo recibido. Actualizando consulta sin repetir la actuación.':'Operación en curso. Espera la respuesta del servidor.'):command.received?'Recibo recibido; consulta pendiente. No se repetirá la actuación.':'Resultado incierto. Se conserva en memoria la cuenta, clave y cuerpo originales.'}</p>
  <p>Solo una acción manual puede continuar. Registrar una actuación no demuestra por sí solo abordaje, salida ni traslado seguro.</p>
  {command.canConsult&&!command.received&&<button className="button quiet" disabled={command.busy} onClick={()=>void command.consult()}>Consultar estado sin repetir actuación</button>}
  <button className="button quiet" disabled={command.busy} onClick={()=>void command.retry().then(result=>{if(result!==undefined)onRecovered?.(result);})}>{command.received?'Actualizar consulta sin repetir actuación':'Reintentar únicamente la actuación original'}</button>
 </section>;
}

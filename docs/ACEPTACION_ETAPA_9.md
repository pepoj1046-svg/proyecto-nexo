# Etapa 9 — Matriz de aceptación integral (laboratorio)

Estado: **propuesta para revisión del propietario**. La aceptación es **ficticia, de
laboratorio**. No inventa un piloto real ni declara aptitud para producción. Base: la cadena
completa hasta 9A. Requisitos de origen:
[REQUISITOS_INICIALES.md](REQUISITOS_INICIALES.md) y el plan maestro.

Leyenda: **Cumple (lab)**, implementado y cubierto por pruebas automáticas · **Parcial** ·
**Simulado**, existe solo como simulación · **No implementado** · **Decisión del comprador**,
depende de reglas que solo el comprador puede fijar.

## 1. Matriz por requisito

| Área (REQUISITOS_INICIALES) | Requisito | Estado | Evidencia o motivo |
| --- | --- | --- | --- |
| §2 Vehículos y filas | 6 plazas por vagoneta, inventario por segmentos | Cumple (lab) | Pruebas de concurrencia (24 reservas simultáneas), 4B1-06 |
| §2 | Registro presencial por la administración, con el mismo inventario | Cumple (lab) | `terminal-sales.spec`, pruebas de terminal |
| §2 | Registro presencial por el **chofer** en horario sin personal | Cumple (lab) | 4B.1: 4B1-01…09, `driver-walk-in.spec` |
| §2 | Asignación mixta: se propone al primer chofer elegible y él acepta | Cumple (lab) | Ofertas al chofer (`/operador`), `functional.spec` |
| §2 | Salida registrada por el chofer; un trufi lleno puede salir primero | Cumple (lab) | `operations.spec`, pruebas de fila y salida |
| §2 | Incorporación a la fila de destino | Cumple (lab) | «Solicitar incorporación a destino», `terminal-return.spec` |
| §2 | Reservas de 1 a 6 plazas y modalidad **expreso** | Cumple (lab) | Pruebas de expreso (7A/7B de la etapa 3), `journey-modes.spec` |
| §2 | División de grupos **solo con consentimiento** | Cumple (lab) | `splitConsent`; pruebas de grupos divididos |
| §2 | Parada/terminal o recogida en punto autorizado; tramos intermedios | Cumple (lab) | Reservas en ruta (`reserve_enroute`), `recovery-road.spec` |
| §2 | Enlace de navegación de Google Maps hacia la parada | **No implementado** | Requiere un servicio externo; no hay enlaces externos (P-6A-1) |
| §2 | La cancelación libera plazas sin alterar el orden | Cumple (lab) | Pruebas de cancelación y revisión (etapa 3, incremento 6) |
| §3 Viajes | Pasajero y chofer ven vehículo, estado y **avisos** | Cumple (lab), avisos simulados | Etapa 6A (6A-01, 6A-E1); los avisos solo existen dentro de la app |
| §3 | Calificar el **viaje** | Cumple (lab) | 5A.7 (5A7-01/02) |
| §3 | Calificar la **aplicación** | No implementado | Fuera del alcance de P-5A7-1 |
| §3 | Pago en efectivo con confirmación y revisión de discrepancias | Simulado | Marcas de pago simulado (016) y conciliación 7A (7A-01/02) |
| §3 | El chofer informa un **viaje adicional** | No implementado | Sin contrato aprobado |
| §3 | Seguimiento **GPS** discreto | No implementado (decisión) | El seguimiento es por paradas (P-6A-1); el GPS exige proveedor y privacidad |
| §3 | Emergencias y **contacto de confianza** del pasajero | No implementado | El rescate operativo existe (etapa 3); el contacto de confianza no |
| §3 | Conexión intermitente sin plazas confirmadas offline | Cumple (lab) | Etapa 5: E5-R04 y E5-R07; B2 y B3 |
| §4 Tarifas | Tarifas ordinarias, expreso y por tramo; precio y versión pactados | Cumple (lab) | Configuración de rutas y tarifas (4A.5), `route-config-fares.spec` |
| §4 | Pago **QR** o combinado; dinero directo a la asociación | **No implementado** | Requiere proveedor bancario (P-7A-1) |
| §4 | Reembolsos de QR gestionados por la asociación | No implementado | Depende del QR |
| §4 | Sin cobros duplicados ante pulsaciones simultáneas | Cumple (lab), simulado | Idempotencia de `simulate_payment` y de los cierres (7A-01) |
| §5 Licencias | Licencias por asociación, gracia, congelación y suspensión | **Decisión del comprador** / No implementado | El plan las condiciona al comprador (P-7A-5); existe la suspensión de asociaciones (ocultar en búsquedas: T13/T14) |
| §6 Administración | Alta de chofer y vehículo revisada por la administración | Cumple (lab) | 4A.1/4A.2: `driver-administration.spec`, `fleet-administration.spec` |
| §6 | La administración gestiona presenciales, filas, tarifas, paradas y rutas | Cumple (lab) | Etapa 4A |
| §6 | Administración general sin intervenir en viajes cotidianos | Cumple (lab) | Plataforma 4A.3: `platform-permissions.spec` |
| §6 | Aislamiento entre asociaciones | Cumple (lab) | RLS en todas las tablas; pruebas A frente a B en cada incremento |
| Transversal | Accesibilidad y móvil | Cumple (lab) | axe en E2E de escritorio y móvil; 5A.3 |
| Transversal | Respaldo y restauración | Cumple (lab) | 8A (8A-01/02) |
| Transversal | Revisión de seguridad | Parcial | [REVISION_AMENAZAS_ETAPA_8.md](REVISION_AMENAZAS_ETAPA_8.md): R1–R8 abiertos |

## 2. Escenarios de aceptación del comprador

Cada escenario se reproduce en el laboratorio local (`npm run dev:web`) y lo cubren las pruebas indicadas.

| # | Escenario | Pruebas |
| --- | --- | --- |
| A1 | Un pasajero busca origen y destino, elige un viaje y registra una reserva | `functional.spec`, `app.spec` |
| A2 | Un grupo de 3 viaja junto; se ofrece la división y solo se aplica si la acepta | Pruebas de grupos y `splitConsent` |
| A3 | Una reserva expreso ocupa la vagoneta completa | `journey-modes.spec` |
| A4 | La administración registra un pasajero en terminal y la fila respeta las 6 plazas | `terminal-sales.spec` |
| A5 | De noche, sin personal, el chofer en turno registra a un pasajero; otro chofer no puede | `driver-walk-in.spec` (E1a–E1d) |
| A6 | El chofer sale, avanza por paradas y termina; el pasajero recibe los avisos | `operations.spec`, 6A-01 |
| A7 | Falla mecánica: incidencia, reasignación y rescate a un vehículo apto de la misma asociación | `recovery-*.spec` (etapa 3) |
| A8 | Se corta la conexión al reservar; tras recargar, el pasajero consulta el resultado sin duplicar | B3: `recovery-panel-*.spec` |
| A9 | El pasajero valora su viaje terminado y la administración ve el resumen anónimo | 5A7-01, 5A7-02 |
| A10 | La administración cierra el día con una discrepancia documentada | 7A-01 |
| A11 | Se respalda el laboratorio y se restaura en una base nueva, con verificación | 8A-01 |
| A12 | «Mi cuenta» y la ayuda funcionan con teclado, en móvil y sin errores de accesibilidad | 5A5-E1, 5A6-E1/E2 |

## 3. Criterio de aceptación propuesto

Se propone aceptar el **laboratorio** cuando se cumplan todas estas condiciones:
1. Todos los escenarios A1–A12 pasan en el CI del SHA final (Ubuntu y Windows, Node 22 y 24) y en una demostración en vivo ante el comprador.
2. El propietario ratifica o corrige cada decisión de
   [DECISIONES_PROVISIONALES.md](DECISIONES_PROVISIONALES.md).
3. Los requisitos marcados como **No implementado** o **Decisión del comprador** quedan
   aceptados como exclusiones del alcance o se encargan como incrementos nuevos.

La aptitud para un **piloto real** exige además resolver los riesgos R1–R8 y las
habilitaciones de proveedores (pagos, avisos y GPS), que no forman parte de esta aceptación.

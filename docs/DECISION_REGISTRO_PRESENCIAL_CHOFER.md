# Decisión de negocio: el chofer registra pasajeros presenciales sin personal de la asociación

Estado: **decisión del propietario registrada; R1–R3 respondidas el 17-11-2026 y el resto por
defecto (§4.1); propuesta de incremento pendiente; nada implementado ni autorizado**.
Fecha: 17 de noviembre de 2026. Base: `main` en `89ec522`.

## 1. Decisión del propietario

No siempre habrá personal de la asociación en la terminal: típicamente después de las
18:00 y antes de las 06:00. En ese horario sí hay choferes. El propietario quiere que, en
ese horario, **el chofer pueda registrar al pasajero que llega en persona**.

Es funcionalidad nueva. No sustituye a la venta presencial del administrador ni a la
reserva por la app, que ya se confirma por turno sin intervención humana (8A/8B).

## 2. Punto de partida comprobado

| Pieza | Estado en `89ec522` |
| --- | --- |
| Venta presencial (`WALK_IN`) | `nexo.reserve` exige `has_role(asociación,'ASSOCIATION_ADMIN')` para `src='WALK_IN'` (`002_operations.sql:77`). Web: `/api/terminal/walk-in` → `web-terminal-service.mjs` → `business.walkIn`. |
| Responsable del grupo presencial | Quien registra un `WALK_IN` queda como responsable del grupo (`group_responsibles`, 020; listados en 033). Con un chofer, esa responsabilidad pasaría a él. |
| Reserva por la app desde la terminal | Se confirma directamente por turno (8A/8B). No necesita personal. |
| Salida del trufi | La registra el chofer sin autorización por viaje. |
| Recogidas en ruta | El chofer acepta o rechaza ofertas (`respond_offer`, 013). |
| Horarios de atención de la asociación | **No existen.** No hay ningún modelo de turnos del personal. |

## 3. Invariantes que no cambian

- Un solo inventario para la app y lo presencial; máximo 6 pasajeros simultáneos por
  segmento; ninguna venta de más, incluso con solicitudes simultáneas.
- Orden de la fila por turno; un chofer no puede saltarse la fila vendiendo en su trufi
  plazas que corresponden al trufi en turno.
- Grupos juntos salvo división consentida; tarifa vigente, sin descuentos ni recargos
  del chofer.
- Asociaciones aisladas: un chofer solo actúa en su asociación y en su propio viaje.
- La plataforma no procesa dinero; idempotencia por clave; ninguna escritura incierta se
  reenvía sola.
- Menores: el chofer no puede aprobar revisiones de menores ni de responsables.

## 4. Preguntas abiertas para el propietario

| ID | Pregunta | Opciones | Propuesta para discutir |
| --- | --- | --- | --- |
| R1 | ¿Cuándo puede registrar el chofer? | (a) horario fijo 18:00–06:00 para todas; (b) cada asociación configura su horario sin personal; (c) el administrador activa y desactiva un «modo sin personal» | (b), con 18:00–06:00 como valor de ejemplo, no impuesto. |
| R2 | ¿Qué chofer puede registrar? | (a) solo el del trufi en turno, en su propio trufi; (b) cualquier chofer en fila, en su propio trufi | (a): conserva el orden de la fila. |
| R3 | Menores, o personas que no pueden viajar solas | (a) bloquear y remitir a la asociación; (b) permitir solo con un adulto registrado en el mismo grupo | Decisión del propietario; el chofer nunca resuelve una revisión. |
| R4 | ¿Quién queda como responsable del grupo presencial? | (a) el chofer; (b) la asociación, con el chofer como registrador | Decisión del propietario; afecta a 020/033. |
| R5 | Revisión posterior | (a) el administrador revisa al día siguiente lo registrado por choferes; (b) sin revisión | (a), solo como trazabilidad: la revisión no anula reservas por sí sola. |
| R6 | Datos del pasajero presencial | Los mismos que hoy registra el administrador, o menos | No pedir más datos personales que la venta presencial actual. |

## 4.1 Respuestas del propietario (17-11-2026)

- **R1:** cada asociación configura su propio horario sin personal.
- **R2:** solo el chofer del trufi en turno puede registrar, y solo en su propio trufi.
- **R3, menor enviado por un adulto en la parada para viajar solo:** quien lo envía debe dar
  su dato de contacto y el de la persona que lo recibirá en el destino, y aclarar el lugar
  de entrega: la parada de la asociación o un domicilio.
- **R3, menor que se presenta solo:** no se le vende la plaza en ese momento. El chofer llama
  a sus padres o tutores al número que proporcione el menor; si no lo proporciona o no hay
  respuesta, llama a las autoridades.

- **R3.1, menor que llega solo y se contacta a los padres o tutores:** deben presentarse en la
  parada para dar la información y enviar al menor, como en el caso del menor enviado por
  un adulto. La llamada sola no basta. Si no se les contacta, se llama a las autoridades
  correspondientes.
- **Prioridad:** el propietario considera muy baja la probabilidad de que un menor viaje solo;
  no hay que profundizar más. Para el resto se adoptan valores conservadores por defecto,
  revisables más adelante:
  - R3.2: el chofer confirma que vio el permiso de viaje de la Defensoría (§4.2) antes de
    registrar a un menor que viaja solo; la app anota solo «permiso verificado», sin números
    de documento.
  - R3.3: cada asociación configura el número de la autoridad a la que se llama; la app no
    llama, solo muestra la instrucción y el número.
  - R3.4: entrega solo en la parada de la asociación, al receptor indicado. La entrega en
    domicilio queda fuera hasta que se decida quién lleva al menor desde la parada.
- **R4–R6:** sin preferencia expresada; se usan las propuestas del §4 (chofer en turno como
  registrador, revisión administrativa al día siguiente solo como trazabilidad, no más datos
  que la venta presencial actual). Los contactos de R3 son datos personales: en laboratorio
  solo ficticios; para un piloto requieren la decisión D06 (retención, borrado y acceso).

## 4.2 Marco legal (información, no asesoría jurídica)

En Bolivia, las Defensorías de la Niñez y Adolescencia municipales emiten las
autorizaciones de viaje de menores y hacen controles en terminales y paradas. La prensa
y la ATT señalan que la compra de pasajes para menores requiere el permiso de la
Defensoría, y que el personal de transporte debe verificarlo junto con la propia
Defensoría y la policía. El Reglamento (DS 2757) prevé requisitos adicionales cuando el
menor viaja solo. Las reglas de R3 deben revisarse con un abogado o con la Defensoría
antes de cualquier piloto; el laboratorio no certifica su cumplimiento.

Fuentes: [UNICEF Bolivia — requisitos de viaje nacional](https://www.unicef.org/bolivia/historias/requisitos-viaje-nacional-para-ninos-ninas-y-adolescentes),
[eju.tv — requisitos de permisos de viaje](https://eju.tv/?p=3228433),
[El País Tarija — control en la terminal](https://elpais.bo/tarija/20200313_advierten-falta-de-control-en-la-terminal-de-tarija-a-menores-en-viaje.html),
[Lexivox — DS 2757](https://www.lexivox.org/norms/BO-DS-N2757.html).

## 5. Implicaciones técnicas (para el diseño, no autorizadas)

- Requiere SQL nuevo: la autoridad de `WALK_IN` está en `nexo.reserve`. Sería una
  migración aditiva (la siguiente libre, hoy 043) con una función propia del chofer que
  reutilice el núcleo de reserva, el mismo inventario y la misma idempotencia. No se
  reescribe 002.
- Sin horario no hay forma de saber si «no hay personal»: R1 decide si se añade un modelo
  de horario por asociación.
- Pruebas mínimas: concurrencia chofer-app-administrador sobre el mismo trufi (6 por
  segmento), chofer de otra asociación, chofer fuera de turno o fuera de horario, grupo
  que no cabe, menores, idempotencia y respuesta perdida tras COMMIT.
- Sería un incremento propio, con su nombre y su autorización. No forma parte de 5A.5.

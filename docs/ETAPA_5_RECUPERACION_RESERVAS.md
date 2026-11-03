# 5A.2 — Recuperación de reservas APP en memoria

Autorización posterior a 5A.1: exclusivamente este incremento de laboratorio.
Base funcional `6b74f40e0cbe60355968ae9828560a2fa6b43d62`; se conservan
001–041. [Plan revisado](PLAN_ETAPA_5.md) y
[diagnóstico 5A.1](REPORTES/ETAPA_5_INCREMENTO_5A1.md) son antecedentes.

## Contrato reutilizado, sin API ni migración nueva

- `GET /api/session`: identidad opaca actual y CSRF; no es un recibo.
- `POST /api/reservations/quote`: revisión previa de condiciones existentes.
- `POST /api/reservations`: reserva QUEUE/ENROUTE existente, cookie, Origin,
  CSRF y clave de idempotencia. Cada reenvío vuelve a pasar por autorización SQL.
- `GET /api/passenger/bookings`: primera página autorizada de reservas propias.
  La consulta completa y paginada sigue disponible en Mis reservas.

Los recibos nativos actor+clave permiten reenviar manualmente la misma intención.
El servicio existente puede fallar al enriquecer su respuesta después del COMMIT.
Ni ese error ni un código HTTP permiten afirmar que la reserva no existe.
No se abre `nexo.actions`, no se crea `/api/attempts/status` ni una fuente paralela.
No es necesaria una nueva API para este piloto; cualquier futura consulta por
clave requerirá contrato y aprobación separados.

## Estados y transiciones

| Estado de cliente | Significado | Próximo paso permitido |
| --- | --- | --- |
| IDLE | Cotización revisable; no se envió este intento | Confirmar explícitamente |
| SENDING | Cuenta de la cotización, clave y cuerpo congelados antes de esperar red | Esperar; no doble envío |
| UNCERTAIN | No se recibió un resultado válido; puede existir COMMIT | Consulta propia o reenvío manual con la misma clave/cuerpo |
| AUTH_REQUIRED | Sesión inválida o cuenta distinta | Autenticar la cuenta original; el siguiente paso vuelve a verificarla |
| RECEIVED | Respuesta válida recibida; lectura posterior en curso | Esperar la lectura; la respuesta se conserva en RAM |
| REFRESH_FAILED | Hay recibo conservado, pero falló comprobar identidad o actualizar consulta | Repetir solo lectura; no otro POST de reserva |
| UPDATED | Recibo recibido y consulta propia completada | Consultar la reserva actual; continuar navegación |

El recibo recibido y la lista actual son hechos distintos. La respuesta de reserva
incluye su estado autorizado en ese instante; una oferta HELD no se convierte en
CONFIRMED, salida ni abordaje. La consulta puede mostrar cambios posteriores.
Una coincidencia de reserva, precio o recorrido no identifica por sí sola el intento.
Una página vacía o parcial no demuestra rollback. La UI identifica expresamente
que muestra la primera página y su total; no promete ausencia en todo el historial.

## Identidad, privacidad y navegación

`ReservationAttempt` conserva únicamente en RAM cuenta opaca, clave, cuerpo original
y respuesta recibida. No guarda credenciales dentro del intento. Clona y congela
también partes del grupo, cotización y consentimientos: reintentar no los recalcula.
El servidor conserva toda autoridad sobre tarifa, grupos, turnos y capacidad.

Se revalida sesión antes del POST, antes de consultar y después de recibir la
consulta. Un cambio de cuenta o revocación oculta resultados privados y solicita
la cuenta original. El CSRF de una nueva sesión se obtiene de nuevo; nunca se
reutiliza un token antiguo para el reenvío. Sin permisos actuales no se fuerza acceso.

La guardia de intención de 4A.6 se reutiliza para bloquear navegación SPA e historial
mientras falta resolver el intento; el formulario permanece montado incluso
durante la recuperación de sesión. Se mantiene la advertencia beforeunload.
Recargar/cerrar forzadamente sigue pudiendo perder toda la RAM: esa advertencia
no es almacenamiento ni garantía de persistencia. No se cancela ni libera una plaza.

No se escucha reconexión para reenviar, no hay polling, cola offline, localStorage,
sessionStorage, IndexedDB ni service worker. Solo acciones explícitas del usuario.
Los fallos del transporte se distinguen de una reserva confirmada por el servidor.

## Límites y revisión humana

Si el backend rechaza ahora el reenvío por permiso, condición, caducidad o conflicto,
se conserva la clave y se ofrece consulta/revisión. No se crea otra intención para
aparentar éxito ni se amplían permisos. Sin una API independiente de recibos no se
resuelve automáticamente toda incertidumbre; el piloto no promete esa capacidad.

No se implementan recuperación tras caída/recarga, perfiles, ayuda, valoraciones,
Android/PWA, dinero, GPS ni comunicaciones. No se cambia ninguna política comercial,
legal, de grupos, menores, ausencias o custodia. Las etapas anteriores permanecen
como fuente de contratos. No se declara cerrado 5A.2: requiere auditoría y revisión.

## Pruebas reproducibles

```text
node --test tests/reservation-attempt.test.mjs tests/web-auth-order.test.mjs
node scripts/test-postgres.mjs --test-name-pattern=5A2-PG
node scripts/test-web.mjs --suite=reservation-recovery.spec.mjs,reservation-receipt.spec.mjs,reservation-session.spec.mjs
npm run test:all
npm run test:web
```

Los mismos comandos funcionan desde PowerShell en Windows con Node 22/24 y las
dependencias fijadas. El runner inicia PostgreSQL efímero, entrega accesos ficticios
por archivo privado y cierra listener/base. No utilizar DATABASE_URL reales.
Las tres suites nuevas usan clústeres independientes para respetar el límite real
de 120 solicitudes/minuto sin aumentarlo ni añadir esperas artificiales.

Los testigos SQL de pruebas son independientes y de solo lectura; comprueban
recibos, reservas, importe/versión, auditoría, capacidad y ausencia de hechos físicos
inventados. Las pruebas de integración inyectan además un fallo de enriquecimiento
tras COMMIT real y recuperan la cuenta original con una sesión nueva.
Capturas ficticias y trazas privadas permanecen bajo `.local`; no se publican
credenciales ni trazas sin depurar. Resultados en el informe del incremento.

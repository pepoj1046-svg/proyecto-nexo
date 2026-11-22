# Capacitación por rol (laboratorio)

Guía breve para la demostración ante el comprador. Usa las cuentas ficticias del archivo
`.local/accesos-<identificador>.json` que muestra `npm run dev:web`. Cada bloque dura entre
10 y 15 minutos y sigue los escenarios A1–A12 de la
[matriz de aceptación](../ACEPTACION_ETAPA_9.md).

## Pasajero

1. **Buscar un viaje (A1):** origen y destino, sin categorías. Mira las plazas por tramo y el máximo de 6.
2. **Reservar y entender estados:** una reserva pendiente no es una reserva confirmada; la tarifa se revalida.
3. **Grupo y expreso (A2, A3):** el grupo va junto; la división solo ocurre con consentimiento expreso.
4. **Corte de conexión (A8):** recarga durante el envío, vuelve a iniciar sesión y usa «Consultar resultado». No hay que reservar otra vez.
5. **Avisos (A6):** en «Mis reservas», «Actualizar avisos». Solo existen dentro de la app.
6. **Valorar (A9):** después de terminar el viaje, una sola vez.
7. **Mi cuenta y ayuda (A12):** preferencias de texto y contraste; ayuda por rol.

## Chofer

1. **Fila y ofertas:** aceptar un viaje propuesto.
2. **Salida y avance:** registrar la salida y las paradas (los pasajeros reciben avisos).
3. **Registro presencial nocturno (A5):** solo en el horario sin personal, solo el trufi en turno, sin menores.
4. **Falla mecánica (A7):** reportarla; la reasignación la decide la administración.

## Administración de la asociación

1. **Presenciales en terminal (A4)** y control de las 6 plazas.
2. **Horario sin personal:** solo un administrador sin ámbito limitado lo cambia.
3. **Incidencias y rescates (A7):** solo vehículos aptos, libres y de la propia asociación.
4. **Valoraciones (A9):** resumen anónimo por ruta.
5. **Conciliación simulada (A10):** declarar lo contado, con nota si no cuadra. Sin dinero real.

## Operación técnica

1. **Arranque y salud:** `npm run dev:web`, y `GET /api/health`.
2. **Respaldo y restauración (A11):** `scripts/lab-backup.mjs`, que verifica los checksums.
3. **Actualización:** `git pull`, `npm ci` y migraciones; nunca editar migraciones aplicadas.
4. **Pruebas:** `npm test`, `npm run test:all` y `npm run test:web`; CI en cada PR.

## Mensajes clave para el comprador

- Es un **laboratorio** con datos ficticios: no hay dinero real, ni GPS, ni avisos externos.
- Lo **simulado** está rotulado como tal en la interfaz.
- Las decisiones provisionales y los riesgos R1–R8 son la lista de trabajo antes de un piloto.

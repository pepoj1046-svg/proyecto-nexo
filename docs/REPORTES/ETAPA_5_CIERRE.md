# Etapa 5 — Auditoría integral y cierre técnico propuesto (5A.8)

Estado: **cierre técnico propuesto, solo laboratorio**, pendiente de ratificación del
propietario. No declara aptitud para producción. Rama `desarrollo/etapa-5a8`, sobre 5A.7.
Plan de referencia: [PLAN_ETAPA_5.md](../PLAN_ETAPA_5.md).

## 1. Incrementos de la etapa

| Incremento | Contenido | PR | Estado |
| --- | --- | --- | --- |
| 5A.1 | Diagnóstico y plan de la etapa 5 | #7 (contenido en `main`) | Integrado |
| 5A.2 | Recuperar reservas APP inciertas con la misma cuenta y clave | #8 | Integrado en `main` |
| 5A.3 | Experiencia móvil, accesibilidad y recuperación de comandos | #9 | Integrado en `main` |
| 5A.4-A | Diseño de la recuperación tras recarga | #10 (contenido en `main`) | Integrado |
| 5A.4-B1 | Sesiones por documento y reautenticación | #11 | Integrado en `main` |
| 5A.4-B2 | Tickets firmados y recibo seguro (con la corrección 042) | #12, #13 | Integrado en `main` |
| 5A.4-B3 | Consulta tras recarga, regeneración de época y salvaguarda D3 | #16 | Integrado en `main` |
| 4B.1 | Registro presencial por el chofer en turno (fuera de la etapa 5; base de la cadena) | #18 | Auditado; pendiente de ratificación |
| 5A.5 | «Mi cuenta» de solo lectura y preferencias de interfaz | #19 | Pendiente de ratificación |
| 5A.6 | Ayuda contextual local por rol | #20 | Pendiente de ratificación |
| 5A.7 | Valoraciones de laboratorio | #21 | Pendiente de ratificación |

**Decisión de cliente (D01 del plan):** se mantiene la **web adaptable**. No hay aplicación
nativa ni PWA con caché de datos privados.

## 2. Matriz de trazabilidad de los requisitos transversales

| Requisito | Dónde se cumple | Pruebas que lo demuestran | Límite conocido |
| --- | --- | --- | --- |
| E5-R01: éxito solo por respuesta autorizada | 5A.2, B2 y B3: recibo del servidor; `HELD` no se presenta como `CONFIRMED` | B2-01…B2-09, B3 T12 y T14 | — |
| E5-R02: clave y cuerpo congelados mientras es incierto | 5A.2 (`reservation-attempt.ts`), B2 (ticket ligado a la clave) | `reservation-attempt.test.mjs`, B2 E2E de reintentos manuales | — |
| E5-R03: diferenciar red, demora, sesión, rechazo, incierto y lectura fallida | 5A.2, 5A.3 y la máquina de estados de B3 | `recovery-panel.test.mjs`, B3 T14, T20 y T21 | — |
| E5-R04: sin reenvíos automáticos | 5A.2, B2 y B3: consulta solo por clic; sin polling | B3 T13, T23 (cinco segundos sin peticiones) y `reservation-recovery.spec` | — |
| E5-R05: reautorización en cada operación | B1: sesión por documento; actor revalidado antes y después en el gateway | B1 E2E y pruebas HTTP de cada endpoint (4B1-08, 5A5-01, 5A7-02) | — |
| E5-R06: aislar cuentas y descartar respuestas tardías | B1 (generación por documento), B3 (generación por consulta) y 5A.5 (generación por carga) | B3 T15 y T16, `recovery-panel-late.spec` | — |
| E5-R07: nada privado en almacenamiento persistente | Tickets de B2 solo en `sessionStorage`, sin credenciales; preferencias de 5A.5 en `localStorage`, sin datos personales | `recovery-ticket-storage.spec`, 5A5-U2, 5A5-E1 | XSS sigue siendo un riesgo heredado (ver `SEGURIDAD_PENDIENTE.md`) |
| E5-R08: lecturas antiguas identificadas | Búsqueda con «Disponibilidad consultada a las…»; la tarifa se revalida antes de registrar | E2E de búsqueda y reserva (5A.3) | — |
| E5-R09: paginación, errores recuperables, teclado y móvil | 5A.3; paneles de 5A.5–5A.7 con axe y sin desbordamiento horizontal; paginación de valoraciones | axe en 5A5-E1/E2, 5A6-E1 y 5A7-E1; T25 de B3 | — |
| E5-R10: perfiles sin efectos sobre membresías ni titularidades | 5A.5 de **solo lectura**; la 044 no tiene escrituras | 5A5-01 (`STABLE`, sin ids), 5A5-E2 y E3 (sin campos editables) | Cambio de contraseña pendiente (P-5A5-2) |
| E5-R11: ayuda y valoraciones sin efectos operativos | 5A.6 sin peticiones ni escrituras; 5A.7 en una tabla aparte, inmutable | 5A6-E1 (sin `/api/`), 5A7-01 (reservas y viajes intactos) | — |
| E5-R12: Node 22/24, PostgreSQL, CSRF/Origin, RLS, auditoría e idempotencia | Matriz de CI Ubuntu/Windows × Node 22/24 y CodeQL; RLS en todas las tablas (prueba `unprotected`) | CI de cada PR (sección 3) | — |

## 3. Evidencia de CI

Cifras del CI de cada SHA, contrastadas en los logs de GitHub Actions.

| PR | SHA | Unitarias | PostgreSQL | E2E por trabajo web | CodeQL |
| --- | --- | --- | --- | --- | --- |
| #16 (B3) | `b5ebf13` | 137/137 | 424/424 | 111/111 | ✅ |
| #18 (4B.1) | `e0e7f23` | 14/14 checks en verde | | | ✅ |
| #19 (5A.5) | ver la nota de cierre | | | | |
| #20 (5A.6) | ver la nota de cierre | | | | |
| #21 (5A.7) | ver la nota de cierre | | | | |

La sección 6 se completa con el CI del SHA final de esta rama.

## 4. Riesgos y pendientes al cerrar la etapa

1. **XSS:** un ticket en `sessionStorage` no sustituye la autenticación (heredado de B2).
2. **Reinicio de PostgreSQL:** bloquea las reservas APP hasta reiniciar el gateway (B3). Debe resolverse antes de cualquier piloto.
3. **D3** es solo de interfaz y por pestaña (B3).
4. **«Mi cuenta»** no permite cambiar la contraseña ni gestionar sesiones (P-5A5-2).
5. Los **textos de ayuda** y las **reglas de valoración** son provisionales (P-5A6-2 y P-5A7-1 a 6).
6. **Intermitencia observada:** B3 T13 agotó su tiempo una vez en «web mobile (ubuntu, Node 24)» en el CI de 5A.5, en un paso de inicio de sesión ajeno al cambio. Se relanzó el trabajo sin tocar timeouts ni reintentos. Si se repite, hay que dividir la suite, como se hizo en B3.

## 5. Conclusión propuesta

La etapa 5 cumple en laboratorio los requisitos E5-R01 a E5-R12, con los límites indicados.
Queda propuesta para cierre técnico de laboratorio, sujeta a:
- la ratificación del propietario de 4B.1, 5A.5, 5A.6 y 5A.7;
- la revisión de las decisiones provisionales;
- el CI verde del SHA final.

## 6. Nota de cierre (CI del SHA final)

Se completa al terminar el CI de esta rama.

# 5A.4-B1 — Sesiones independientes por documento (en desarrollo)

Base funcional exacta: `3d16680f491ff2c516eb1796b0954a717b49a153`.
Rama: `desarrollo/etapa-5a4-b1`. Diseño incorporado sin merge desde
`076662c5490834b5e08bb5dd101caaad4866a360`, PR #10.

## Primer incremento verificable

- La cookie HttpOnly/SameSite identifica únicamente un contenedor del navegador.
  No contiene ni selecciona una cuenta. Iniciar/cerrar sesión no cambia su valor.
- Cada documento obtiene un selector UUID, generación y CSRF independiente;
  solo una autenticación real vincula el token SQL a ese contexto. El token SQL
  nunca sale del servidor. Las pruebas del cliente permanecen en memoria.
- Un GET `/api/session` sin selector crea un contexto **anónimo nuevo**; no puede
  descubrir secretos autenticados mediante la cookie o un selector conocido.
- Todos los POST privados de la tabla fija del gateway y los GET privados
  comprueban contexto y prueba. Las operaciones privadas revalidan sesión SQL
  antes/después de ejecutar el servicio. La generación se comprueba tras esperas.
- Login concurrente usa sustitución condicionada al contexto observado; el token
  no instalado se revoca. Logout elimina exclusivamente el contexto seleccionado.
- El cliente descarta continuaciones de una generación anterior. `pagehide`
  oculta el árbol privado antes de restauración, invalida pruebas RAM y conserva
  montados los controladores de intenciones. Para desbloquear exige contraseña
  de la cuenta original, sin reproducir comandos automáticamente.
- Recuperación 5A.2 adaptada al 401 explícito del nuevo contrato de sesión, sin
  cambiar claves, cuerpos, recibos ni las reglas de negocio.

## Validaciones ya ejecutadas en el primer avance

- TypeScript y compilación web aprobados.
- 98 pruebas unitarias aprobadas (incluidas ocho de contextos, concurrencia,
  límites, CSRF y revocación).
- Cinco pruebas dirigidas PostgreSQL 18.4 aprobadas: F09, W07, W08, O07, Z07.
- Dirigidas Chromium escritorio: dos de reservation-session, una de
  reservation-identity-read y una de private-account-read aprobadas.
- Detectada adaptación pendiente de una aserción administrativa: el nuevo 401
  oculta la consulta hasta la reautenticación explícita; se conserva el recibo.

## Pendiente antes de proponer cierre

Completar escenarios reales multi-pestaña del mismo BrowserContext, bfcache,
regresión completa PostgreSQL/E2E escritorio y móvil, CI Ubuntu/Windows Node
22/24 y CodeQL sobre el commit final. Este avance **no cierra B1**.

No se añadieron migraciones, almacenamiento persistente, tickets, endpoints de
recuperación de recibos ni reglas de negocio. No se inició B2/B3.

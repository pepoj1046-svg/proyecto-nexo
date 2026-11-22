# 5A.5 — «Mi cuenta» y preferencias de interfaz

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
Rama `desarrollo/etapa-5a5`, sobre `desarrollo/etapa-4b1` (`e0e7f23`). Encargo del
propietario del 21-11-2026; decisiones provisionales P-5A5-1 a P-5A5-3 en
[DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md).

## Qué añade

- **Página `/cuenta`** («Mi cuenta» en la navegación):
  - Sin sesión, muestra el acceso de laboratorio y las preferencias.
  - Con sesión, muestra el nombre visible y los roles activos, con su asociación y la marca «Ámbito limitado» cuando corresponde, además de «Cerrar sesión».
  - No hay ningún campo editable de identidad.
- **Preferencias de interfaz:** texto más grande (zoom de la página al 115 %), contraste alto y reducir animaciones.
  - Se aplican al instante y se guardan solo en `localStorage` (`nexo.lab.preferences.v1`).
  - Si el navegador no deja guardarlas, se aplican igual y se avisa.
  - Un almacenamiento corrupto vuelve a los valores por defecto.
- **Migración 044** (`web_my_account`), aditiva y de solo lectura:
  - Es `STABLE SECURITY DEFINER`, con `search_path` fijado.
  - El actor sale de la sesión y se revalida al final.
  - Lista solo membresías activas propias.
  - `EXECUTE` solo para `nexo_app`.
  - No añade tablas ni escrituras.
- **Endpoint `POST /api/account`:**
  - Usa el envoltorio `authenticated`, con CSRF, documento y actor revalidado antes y después.
  - El cuerpo es cerrado (`{}`) y la transacción es `READ ONLY`.
  - Devuelve una proyección cerrada: nombre y roles, sin identificadores internos.
- **CI:** los workflows corren en todo PR hacia `desarrollo/**`, así los incrementos encadenados no tienen que tocarlos uno por uno.
- **`AGENTS.md`:** registra el estado real y la autorización vigente.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `5A5-01` (PostgreSQL) | Nombre y roles propios para pasajero, chofer y administrador. Sin identificadores internos. Membresías inactivas ocultas. Sesión revocada o desconocida rechazada. Cuerpo cerrado. ACL mínima y función `STABLE`. |
| `5A5-U1` | La proyección descarta campos ajenos y roles desconocidos, y trunca el nombre. |
| `5A5-U2` | Las preferencias corruptas o con tipos inválidos vuelven a los valores por defecto. |
| `5A5-U3` | Se aplican exactamente las tres clases de preferencia. |
| `5A5-E1` | Las preferencias se aplican sin sesión, sobreviven a la recarga y no llaman al servidor. Sin violaciones de accesibilidad ni desbordamiento horizontal. |
| `5A5-E2` | El pasajero ve solo su nombre, sin roles ni campos editables, y puede cerrar sesión. |
| `5A5-E3` | El administrador ve su rol, en solo lectura. |

Las 26 listas de migraciones de la prueba de integración y la lista de funciones nuevas de
`4B1-09` incluyen ahora la 044.

**No ejecutadas en local:** esta sesión no tiene acceso a npm. La migración se aplicó y se
probó en un PostgreSQL 16 local (con sesión válida, revocada y vacía). La batería completa
queda a cargo del CI del PR.

## Límites

- No hay cambio de contraseña, gestión de sesiones ni edición de datos (P-5A5-1 y P-5A5-2).
- Las preferencias no viajan entre dispositivos (P-5A5-3).

# Revisión de amenazas — Etapa 8 (laboratorio)

Alcance: la web adaptable, el gateway HTTP local, PostgreSQL y los scripts de laboratorio en
`main` y en la cadena hasta 8A. Método: STRIDE por componente, con los controles que ya
existen y verifican las pruebas, y con los riesgos residuales que **impiden** un piloto
real hasta resolverlos. No evalúa infraestructura pública: no existe y se decide aparte.

## 1. Controles verificados

| Amenaza (STRIDE) | Vector | Control vigente | Evidencia |
| --- | --- | --- | --- |
| Suplantación | Robo de cookie o token | Sesiones por documento (B1), cookie opaca, CSRF y Origin en todo POST privado; el actor se deriva de la sesión en PostgreSQL | Pruebas HTTP de B1 y de cada endpoint (4B1-08 y siguientes) |
| Suplantación | Pasajero que se hace pasar por chofer o por la administración | Autoridad decidida en SQL (`has_role`, `drives`, `manage_route`, `full_admin`); nunca por campos del cliente | 4B1-04, 5A7-01, 7A-02 |
| Manipulación | Sobreventa de plazas | Inventario por segmentos con bloqueo de ruta, 6 plazas por segmento y orden de fila (`QUEUE_ORDER`) | Pruebas de concurrencia (24 reservas simultáneas), 4B1-06 |
| Manipulación | Reescribir auditoría, valoraciones, cierres o avisos | Triggers de inmutabilidad (`immutable_audit`, `guard_notice_change`) | 5A7-01, 6A-01, 7A-01 |
| Manipulación | Reintento que duplica operaciones | Idempotencia por clave de acción (`action_start` y `action_finish`) en todas las escrituras | B2, 5A7-01, 7A-01 |
| Repudio | Cambios sin autor | Eventos de auditoría con actor; cierres con `actor_id` | Pruebas de auditoría de las etapas 3 y 4 |
| Divulgación | Lectura entre asociaciones | RLS en todas las tablas (la prueba `unprotected` exige RLS en cada tabla `nexo`); funciones `SECURITY DEFINER` con comprobaciones explícitas de dueño | Prueba de RLS, 5A7-02, 6A-01 |
| Divulgación | Identidad del pasajero en valoraciones | Proyección anónima sin ids | 5A7-02 |
| Divulgación | Cabeceras y almacenamiento del navegador | CSP estricta sin scripts externos, `nosniff`, `no-referrer`, `Permissions-Policy` sin geolocalización, cámara ni micrófono; nada privado en `localStorage` | Cabeceras del gateway, `recovery-ticket-storage.spec`, 5A5-E1 |
| Denegación de servicio | Ráfagas de peticiones | Límite global de 120 solicitudes por minuto, 32 conexiones, cuerpos acotados, `statement_timeout` y `lock_timeout` | Gateway; división de suites E2E por el 429 |
| Elevación | Ejecutar funciones internas | `REVOKE` a PUBLIC y a los roles no necesarios; `EXECUTE` solo para `nexo_app` en las funciones `web_*` | Pruebas de ACL de cada incremento |
| Elevación | Inyección de `search_path` | `SET search_path=pg_catalog,nexo,pg_temp` en cada función `SECURITY DEFINER` | Revisión de 042–048 |

## 2. Riesgos residuales (bloquean un piloto real)

| # | Riesgo | Impacto | Mitigación propuesta |
| --- | --- | --- | --- |
| R1 | XSS: si llegara a inyectarse un script, podría leer el ticket de `sessionStorage` y actuar con la sesión del documento | Alto | Mantener la CSP sin `unsafe-inline`; revisar dependencias; añadir Trusted Types antes de un piloto |
| R2 | Un reinicio de PostgreSQL bloquea las reservas APP hasta reiniciar el gateway (B3) | Medio, disponibilidad | Regenerar la época también ante un cambio de postmaster, con una prueba específica |
| R3 | El respaldo de laboratorio contiene hashes de contraseñas y de sesiones ficticias | Medio | El archivo se crea con modo 600 y nunca sobrescribe; fuera de git (`.local/`). En producción: cifrado en reposo y rotación |
| R4 | `/api/health` es público | Bajo (solo informa que la base responde y qué migración tiene) | Restringirlo a la red interna en un despliegue |
| R5 | No hay cambio de contraseña ni cierre de otras sesiones desde «Mi cuenta» | Medio | Incremento de identidad (P-5A5-2) |
| R6 | La atestación «sin menores» del chofer no es verificable | Medio (riesgo del negocio) | Protocolo de la asociación; auditoría de registros del chofer (4B.1) |
| R7 | Fuerza bruta de credenciales | Medio | Ya existe una limitación de intentos por clave de acceso, en ventanas de 15 minutos (`identity_attempt`, 010). Antes de un piloto, revisar los umbrales y añadir un límite por origen en el gateway |
| R8 | Dependencias de npm con scripts de instalación (esbuild, embedded-postgres) | Medio, cadena de suministro | Aprobar scripts de forma explícita (`allowScripts`), fijar versiones y generar el SBOM (etapa 10) |

## 3. Fuera de alcance

Infraestructura pública, TLS, WAF, gestión de secretos en la nube, presupuesto y
cumplimiento legal: según el plan maestro, se deciden aparte con el comprador.

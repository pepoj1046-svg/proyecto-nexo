# Administración de asociaciones y autoridad — 4A.3

Solo laboratorio, base 3a49f43. [ADR y amenazas](ADR_ADMINISTRACION_GENERAL_ETAPA_4.md).
001–036 inmutables tras la primera publicación;036 añade el módulo y037
refuerza la revisión de identidad sin migrar datos operativos.

## Facultades

| Actor | Facultades de este corte |
|---|---|
| GENERAL_ADMIN explícito | Catálogo técnico global, alta LAB inerte, delegación/revocación ADMIN de asociación, solicitudes de revisión de estados e historia administrativa mínima. |
| ADMIN asociación | Sus operaciones existentes, directorio y DRIVER de4A.1/4A.2 según alcance. No crea asociaciones ni administradores. |
| REVIEWER | Revisiones técnicas existentes, sin provisión ni autoridad global. |
| DRIVER/PASSENGER | Sus operaciones existentes; sin acceso a consola general. |
| Operador confiable offline | Instalación inicial única y atestación LAB. Provisión separada; ninguna conexión privilegiada entra al gateway. |

La autoridad global no implica membresía de asociación, lectura privada de pasajeros,
exención RLS, modificación de inventario ni habilitación legal. No se ofrece crear
más autoridades globales en este corte. Delegar significa una membresía ADMIN de
asociación concreta, no delegación global o modificación de rutas.

## Primer acceso transferible

El instalador del comprador prepara las migraciones y una conexión local de
privilegio mínimo que solo hereda nexo_provisioner; mantenerla fuera del listener.
No usar un propietario como conexión de runtime. El comando valida autoridad
real y laboratorio 127.0.0.1, base nexo_test_<hex>. Es una herramienta de laboratorio,
no instalación productiva terminada.

```powershell
# Configurar NEXO_PROVISION_DATABASE_URL por canal local privado, nunca Git/logs.
node scripts/platform-access.mjs --initialize --confirm --login=lab-propietario --reason="Inicializacion explicita ficticia" --output=.local/primer-acceso.json
```

Genera contraseña única con randomBytes y hash scrypt; crea identidad nueva,
atestación y marcador singleton en transacción. La consola imprime solo estado y
ruta, nunca secretos. Archivo exclusivo, modo0600; Windows requiere ACL privada del
operador. No sobrescribir un archivo existente. Conservarlo con protección local;
no adjuntarlo a PR, soporte, capturas o informe. Repetir bootstrap falla aunque se
pierdan las sesiones. Nunca se eleva el primer registro público.

Si se pierde la respuesta del COMMIT, el archivo se **conserva**: no repetir
inicialización, no borrarlo automáticamente. Consultar el estado local con el
operador y probar acceso existente. Si el fallo es anterior al intento de commit,
el archivo incompleto se elimina y la transacción revierte. Un archivo tras caída
no demuestra por sí solo que la instalación haya confirmado.

Para un candidato, la identidad digital debe existir. El operador confiable revisa
el vínculo técnico ficticio y registra una atestación, sin documentos personales:

```powershell
node scripts/platform-access.mjs --attest --confirm --user-ref=<uuid-ficticio-verificado> --code=LAB-ADMIN-UNO --reason="Atestacion tecnica ficticia revisada"
```

No es una verificación jurídica. No puede llamarse desde HTTP. Un número de reserva,
UUID o nombre aportado por navegador no concede nada. La atestación vincula cuenta,
código y versión; un cambio de credenciales exige atestar de nuevo para nuevas
concesiones. Para revocar una concesión ya existente basta el vínculo histórico
atestiguado; no se exige rehabilitar identidad o ampliar su alcance.

La recuperación de contraseña existente conserva roles; no concede autoridad nueva.
La sustitución de GENERAL_ADMIN por pérdida total o cambio de propietario exige
procedimiento del comprador y queda bloqueada, sin claves maestras ni backdoors.

## Operaciones cerradas

- POST `/api/platform/context`: autoridad y, opcionalmente, asociación con tres
  estados separados, revisión y administradores técnicos de esa asociación.
- POST `/api/platform/page`: ASSOCIATIONS, CANDIDATES o HISTORY, páginas1–100,
  cursor ligado a sesión/consulta/tamaño/snapshot. No contraseña, login ni principalSQL.
- POST `/api/platform/command`: REGISTER, DELEGATE, REVOKE o STATE_REVIEW.
  Motivo1–200, confirmed=true y clave idempotente obligatorios. Salvo REGISTER,
  requiere revisión SHA256 esperada. SQL y JS rechazan propiedades extra.

REGISTER exige código LAB único y nombre LAB ficticio. Crea únicamente asociación y
código técnico, con SUSPENDED/PENDING/SUSPENDED explícitos. DELEGATE asigna ADMIN
completo a identidad activa y atestación vigente, sin tocar limitaciones previas;
si tiene ámbito restringido exige revisión. REVOKE desactiva solo membresía local.
No bloquea identidad global ni cambia derechos en otras asociaciones.

STATE_REVIEW conserva estado original y registra motivo para decisión humana. No
es una activación ni resolución legal. Las revisiones operativas de REVIEWER
anteriores no se convierten en facultad global. Dar de alta no habilita rutas,
vehículos, permisos ni ventas. Políticas de habilitación, licencias, suspensiones
comerciales y recuperación de autoridad quedan pendientes del comprador.

## Consistencia y último administrador

PostgreSQL es la única autoridad. Mutex común y READ COMMITTED obligatorio para
bootstrap, atestación, delegación y wrappers offline de membresía/identidad/ámbito.
Evita que snapshots fijos eludan el conteo al retirar administradores distintos.
Luego se bloquea el ámbito del sujeto y se estabiliza identidad/sesión. Revalidar
hora real y autoridad tras espera, incluso para replay. Las revisiones incorporan
historia offline para invalidar cambios ABA, sin modificar hechos anteriores.

Último ADMIN efectivo: membresía activa, identidad gestionada activa y alcance
completo. Una membresía legacy sin cuenta no es recuperación alternativa. Las
asociaciones históricas sin administrador recuperable requieren regularización
local; no se crean cuentas en una migración. Retirar el último efectivo falla
atómicamente por los tres caminos: rol, identidad y restricciones. GENERAL_ADMIN
único no se puede desactivar mediante provisión. Operador SQL propietario continúa
siendo frontera de confianza: no se promete resistir a un dueño que modifica DDL.

Auditoría específica privada e inmutable, con actor/asociación/sujeto/motivo/resultado.
Los rechazos con excepción revierten también sus cambios y no se declaran eventos
persistidos. La interfaz conserva cuerpo/clave ante respuesta incierta o refresco
fallido después de commit. Un rechazo definitivo retira intención y exige consultar
y confirmar de nuevo. Idempotencia no sustituye reautorización.

## Reproducción web en Windows

```powershell
npm ci --no-fund
npx --no-install playwright install chromium
$env:NEXO_WEB_PLATFORM_FIXTURE='1'
$env:NEXO_WEB_PLATFORM_HISTORY_FIXTURE='1'
npm run dev:web
# Ctrl+C al terminar; limpiar variables:
Remove-Item Env:NEXO_WEB_PLATFORM_FIXTURE
Remove-Item Env:NEXO_WEB_PLATFORM_HISTORY_FIXTURE
```

Abrir la URL127.0.0.1 indicada, página Plataforma. Los accesos efímeros están solo
en el archivo privado indicado por terminal. Entrar como platform; registrar
LAB-ASOC con motivo y confirmación; seleccionarla y asignar LAB-ADMIN-UNO y
LAB-ADMIN-DOS. Revocar uno funciona; retirar el último se rechaza sin cambios.
Los candidatos del fixture son candidate1/candidate2. Comprobar sus accesos en otra
sesión y la falta de acceso a otras asociaciones. admin/reviewer/driver5/operativo0
no acceden a plataforma. En Horizonte consultar dos páginas de52 actuaciones;
registrar revisión deja los tres estados intactos. No usar cuentas reales.

Automatización: `node --test tests/platform-admin.test.mjs`,
`node scripts/test-postgres.mjs --test-name-pattern=4A3`,
`node scripts/test-web.mjs --suite=platform-administration.spec.mjs,platform-admin-races.spec.mjs`,
y finalmente `npm run test:all` / `npm run test:web`. Los tests crean y cierran su
propio laboratorio. No se afirma ejecutar manualmente Windows; se distingue CI.

##037: identidad atestada y formularios anteriores

La intención también se liga a todas las atestaciones LAB y su historia inmutable.
Reasignar/restaurar un código invalida una delegación o revocación anterior: no se
aplica a un destinatario distinto del revisado. El efecto es conservador y global:
incluso una atestación de otro candidato obliga a consultar y confirmar de nuevo.
Los recibos anteriores conservan su resultado después de reautorizar al actor; no
se reejecutan contra la identidad actual del código. Actualizar036→037 conserva
filas, recibos, checksums y OID. Ninguna política comercial nueva.

## Recuperación de interfaz auditada en4A.6

La navegación SPA y el cambio de sesión no desmontan un intento administrativo
incierto. Si la sesión caducó, se ofrece reautenticación de la cuenta original,
conservando cuerpo/clave en memoria y ocultando el formulario hasta recuperarla.
Otra cuenta no puede desbloquearlo. Un rechazo definitivo sigue exigiendo contexto
y confirmación nuevos. Recargar/cerrar forzosamente puede perder el intento;
no hay almacenamiento de secretos en navegador. Ver [guía](ETAPA_4_GUIA_ADMINISTRACION.md).

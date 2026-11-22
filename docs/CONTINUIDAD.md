# Continuidad del trabajo de Claude — Proyecto Nexo

Archivo vivo. Se actualiza después de cada avance importante para que una sesión nueva
continúe sin repetir trabajo. La versión válida es siempre la de la **rama más avanzada**
de la cadena (ver «Ramas»).

## Objetivo principal

Completar en laboratorio 5A.5–5A.8 y las etapas 6–10 del [plan maestro](PLAN_MAESTRO_10_ETAPAS.md),
por encargo del propietario del 21-11-2026. Claude toma las decisiones de negocio como
provisionales en [DECISIONES_PROVISIONALES.md](DECISIONES_PROVISIONALES.md) y, al terminar,
entrega un informe para que el propietario revise y pida correcciones. Nada se fusiona
en `main` sin su ratificación.

## Estado actual (21-11-2026)

| Incremento | Rama | PR | Estado |
| --- | --- | --- | --- |
| 4B.1 registro presencial del chofer | `desarrollo/etapa-4b1` (`e0e7f23`) | #18 → `main` | Auditado y APROBADO; CI 14/14; pendiente de ratificación. |
| 5A.5 Mi cuenta | `desarrollo/etapa-5a5` | #19 → `etapa-4b1` | Implementado; CI en curso. |
| 5A.6 Ayuda contextual | `desarrollo/etapa-5a6` | #20 → `etapa-5a5` | Implementado; CI en curso. |
| 5A.7 Valoraciones | `desarrollo/etapa-5a7` | #21 → `etapa-5a6` | Implementado (migración 045); CI en curso. |
| 5A.8 Cierre de la etapa 5 | `desarrollo/etapa-5a8` | #22 → `etapa-5a7` | Documento de cierre redactado; falta completar la nota con el CI final. |
| 6A Seguimiento por paradas y avisos | `desarrollo/etapa-6a` | #23 → `etapa-5a8` | Implementado (migración 046); CI en curso. |
| 7A Conciliación simulada | `desarrollo/etapa-7a` | #24 → `etapa-6a` | Implementado (migración 047); CI en curso. |
| 8A Operabilidad | `desarrollo/etapa-8a` | #25 → `etapa-7a` | Respaldo y restauración, salud (048) y amenazas; CI en curso. |
| 9A Aceptación integral | `desarrollo/etapa-9a` | #26 → `etapa-8a` | Matriz y escenarios (`docs/ACEPTACION_ETAPA_9.md`). |
| 10A Transferencia | `desarrollo/etapa-10a` | ver abajo | Paquete en `docs/TRANSFERENCIA/` e inventario de licencias con prueba. |

## Ramas

Cadena: `main` ← `desarrollo/etapa-4b1` ← `desarrollo/etapa-5a5` ← `desarrollo/etapa-5a6` ← `desarrollo/etapa-5a7` ← `desarrollo/etapa-5a8` ← `desarrollo/etapa-6a` ← `desarrollo/etapa-7a` ← `desarrollo/etapa-8a` ← `desarrollo/etapa-9a` ← `desarrollo/etapa-10a` (punta de la cadena). Cada PR
va en borrador hacia la rama anterior.

## Lecciones técnicas que no deben perderse

- **Sin npm en la sesión de Claude:** las pruebas completas solo corren en el CI (unos 30 min
  por SHA). Hay un PostgreSQL 16 local en `/usr/lib/postgresql/16/bin` para aplicar las
  migraciones y probar funciones SQL antes de subir.
- **Cada migración nueva** obliga a:
  1. añadirla a las listas de `migrate()` de `tests/integration/postgres.test.mjs` (todas las que terminan en la última migración);
  2. subir el `rowCount` de `nexo_migrations`;
  3. añadir sus funciones a la lista exacta de funciones nuevas de la prueba `4B1-09`;
  4. si crea tablas, añadirlas a `tables043`, o a un helper equivalente, y al `TRUNCATE` de la fixture.
- Las cuentas E2E con acceso salen de `scripts/seed-web-demo.mjs` (línea 156): `viajero0-9`,
  `driver0-7`, `adminH`, `adminU`, `adminR`, `terminal0`, `operativo0-1`. Las demás (`admin`,
  `reviewer`, `platform`) solo existen con ciertas fixtures. Cada suite E2E nueva se
  registra en `allSuites` de `scripts/test-web.mjs`.
- Los workflows ya corren en todo PR hacia `desarrollo/**`.
- **Cada página nueva** de la web debe añadirse al `Set` `pages` de `src/http/web-gateway.mjs`; si no, el servidor no entrega la aplicación para esa ruta (fallo real de 5A.5).
- **Cada error de negocio nuevo** debe añadirse a la expresión `known` del gateway; si no, llega como un error genérico.
- **Cada tabla nueva** debe ir en el `TRUNCATE` del `beforeEach`, en `tables043` y en las listas `after` de las pruebas de actualización.
- **Lista de funciones nuevas de `4B1-09`:** debe ir en el orden de `sort()` de JS (código ASCII): `web_ratable_bookings` va antes que `web_rate_service`. Hay que calcularla con `sorted()`.
- **Ramas encadenadas:** una corrección en una rama inferior se propaga con `git merge` hacia las superiores.
- El límite global del gateway es de 120 solicitudes por minuto: dividir las suites E2E
  largas.
- El push desde la PC del propietario necesita Git Credential Manager. Desde la sesión de
  Claude, se usa `git -c push.negotiate=true push`.

## Próximo paso exacto

Todas las etapas tienen PR. Queda:
1. Seguir el CI de #19–#27 hasta que todos estén en verde. Relanzar los trabajos intermitentes. Corregir lo que falle en la rama más baja afectada y propagarlo con merge hacia arriba.
2. Completar la sección 3 y la nota de cierre de `docs/REPORTES/ETAPA_5_CIERRE.md` con las cifras reales.
3. Entregar al propietario el informe final (artefacto o documento) con lo hecho, las decisiones provisionales que revisar, los PR y cómo probar.

## Prompt de reanudación

> Retomemos Proyecto Nexo (pepoj1046-svg/proyecto-nexo). Usa las skills `proyecto-nexo`,
> `nexo-auditoria-seguridad` y `nexo-pruebas-calidad`. Lee `docs/CONTINUIDAD.md` en la rama
> más avanzada de la cadena (`git ls-remote` para verla) y continúa exactamente desde
> «Próximo paso exacto», sin repetir lo terminado. Encargo vigente del 21-11-2026: completar
> 5A.5–5A.8 y las etapas 6–10 en laboratorio, decidiendo tú lo necesario como provisional
> en `docs/DECISIONES_PROVISIONALES.md`. No fusiones en `main`. Actualiza
> `docs/CONTINUIDAD.md` después de cada avance.

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
| 5A.5 Mi cuenta | `desarrollo/etapa-5a5` | ver abajo | Implementado; esperando CI. |
| 5A.6 Ayuda contextual | — | — | Siguiente. |
| 5A.7 Valoraciones | — | — | Pendiente (decisión provisional prudente). |
| 5A.8 Cierre de la etapa 5 | — | — | Pendiente. |
| Etapas 6–10 | — | — | Pendientes. |

## Ramas

Cadena: `main` ← `desarrollo/etapa-4b1` ← `desarrollo/etapa-5a5` ← (siguientes). Cada PR
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
- El límite global del gateway es de 120 solicitudes por minuto: dividir las suites E2E
  largas.
- El push desde la PC del propietario necesita Git Credential Manager. Desde la sesión de
  Claude, se usa `git -c push.negotiate=true push`.

## Próximo paso exacto

1. Abrir el PR de 5A.5 hacia `desarrollo/etapa-4b1` y esperar su CI.
2. Empezar 5A.6 (ayuda contextual local por rol y estado) en `desarrollo/etapa-5a6`, sobre 5A.5.

## Prompt de reanudación

> Retomemos Proyecto Nexo (pepoj1046-svg/proyecto-nexo). Usa las skills `proyecto-nexo`,
> `nexo-auditoria-seguridad` y `nexo-pruebas-calidad`. Lee `docs/CONTINUIDAD.md` en la rama
> más avanzada de la cadena (`git ls-remote` para verla) y continúa exactamente desde
> «Próximo paso exacto», sin repetir lo terminado. Encargo vigente del 21-11-2026: completar
> 5A.5–5A.8 y las etapas 6–10 en laboratorio, decidiendo tú lo necesario como provisional
> en `docs/DECISIONES_PROVISIONALES.md`. No fusiones en `main`. Actualiza
> `docs/CONTINUIDAD.md` después de cada avance.

# Etapa 7A — Conciliación diaria simulada

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
**Sin dinero real.** Rama `desarrollo/etapa-7a`, sobre 6A. Decisiones provisionales P-7A-1
a P-7A-6 en [DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md).

## Qué añade

- **Migración 047:**
  - Tabla `cash_closings`: un cierre por asociación y día.
    - Es inmutable, tiene RLS activa y no tiene permisos directos.
    - Sus `CHECK` garantizan que diferencia = declarado − esperado, que el estado sea coherente con la diferencia y que una discrepancia lleve nota.
  - Funciones internas:
    - `full_admin`: administrador sin ámbito limitado.
    - `expected_cash`: la última marca de cada grupo verificada ese día.
    - `cash_day_ok`: día entre hoy y 31 días atrás.
  - Funciones para `nexo_app`:
    - `web_reconciliation_associations`.
    - `web_reconciliation`: esperado, grupos, desglose por ruta y cierre si existe.
    - `web_close_cash_day`: idempotente por clave, con bloqueo de la asociación. Responde `ALREADY_CLOSED` o `NOTE_REQUIRED` según el caso.
- **Endpoints:** `POST /api/reconciliation/associations`, `/day` y `/close`, con cuerpos cerrados y los importes como texto decimal.
- **Panel «Conciliación diaria (simulada)»** en «Administración»: elegir asociación y día, ver el esperado y su desglose, declarar lo contado y cerrar.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `7A-01` (PostgreSQL) | El esperado sigue la última marca (la revocada no cuenta). Nota obligatoria si hay discrepancia. Reintento con la misma clave; con otra clave, `ALREADY_CLOSED`. Cierre `CUADRA`. Inmutabilidad. Reservas intactas. |
| `7A-02` (PostgreSQL) | Rechazo para administrador de otra asociación, chofer, pasajero y administrador limitado. Días fuera de rango, importes y notas inválidos. ACL mínima y funciones internas no ejecutables por la aplicación. |
| `7A-U1`, `7A-U2` | Importes como texto decimal y días ISO reales. |
| `7A-E1` | El panel declara «Sin dinero real», y un administrador limitado no puede conciliar. Pasa axe. |

La 047 se aplicó en un PostgreSQL 16 local. Se probaron el esperado con una revocación, la
nota obligatoria, la discrepancia, el reintento, `ALREADY_CLOSED`, el rechazo al chofer y el
día futuro. **No ejecutadas en local** (la sesión no tiene npm). La batería completa la cubre
el CI del PR.

## Límites

- No hay cobro real, pasarela ni comisiones (P-7A-1 y P-7A-5).
- El cierre es diario, no por turno (P-7A-3).

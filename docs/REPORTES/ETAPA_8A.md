# Etapa 8A — Operabilidad: respaldo y restauración, salud y amenazas

Estado: **implementado, pendiente de CI y de revisión del propietario**. Solo laboratorio.
Rama `desarrollo/etapa-8a`, sobre 7A. Decisiones provisionales P-8A-1 a P-8A-3.

## Qué añade

- **Respaldo y restauración reproducibles** (`src/db/lab-backup.mjs` y `scripts/lab-backup.mjs`):
  - Exportación consistente (`REPEATABLE READ READ ONLY`) de las 93 tablas `nexo` y del registro de migraciones, con conteo y SHA-256 por tabla.
  - La restauración exige una base migrada con exactamente las mismas migraciones y completamente vacía; nunca sobrescribe.
  - Inserta dentro de una transacción con `session_replication_role=replica`, ajusta las secuencias de identidad y **verifica el checksum de cada tabla**.
  - Rechaza respaldos con otro formato, manipulados o de otra versión de esquema.
  - Uso: `MIGRATION_DATABASE_URL=… node scripts/lab-backup.mjs backup|restore <archivo>`. El archivo se crea con modo 600 y no sobrescribe; guárdalo fuera de git.
- **Migración 048, `lab_health`**, y **`GET /api/health`**:
  - Informa si la base responde, el número de migraciones y la última; si no responde, devuelve 503.
  - No expone secretos ni datos de usuarios.
- **[Revisión de amenazas](../REVISION_AMENAZAS_ETAPA_8.md):** controles STRIDE verificados por pruebas y 8 riesgos residuales que bloquean un piloto.

## Pruebas

| Prueba | Qué verifica |
| --- | --- |
| `8A-01` (PostgreSQL) | Respaldo con datos reales de la fixture → base nueva migrada → restauración con checksums idénticos en todas las tablas. Las secuencias continúan. Las reglas siguen vigentes. Una segunda restauración se rechaza (`TARGET_NOT_EMPTY`). |
| `8A-02` (PostgreSQL) | Formato ajeno, fila añadida sin actualizar el checksum (`BACKUP_CORRUPT`) y migraciones distintas (`MIGRATIONS_DIFFER`): se rechazan sin escribir nada. |
| `8A-03` (PostgreSQL) | `lab_health` informa 48 migraciones y la última, con claves cerradas y ACL mínima. |

La reinserción con `OVERRIDING SYSTEM VALUE` y el ajuste de secuencias se verificaron en un
PostgreSQL 16 local, con checksum idéntico. **No ejecutadas en local:** las pruebas Node
(la sesión no tiene npm). La batería completa la cubre el CI del PR.

## Límites

- No hay respaldo cifrado ni programado; es un procedimiento manual de laboratorio (R3).
- Pruebas de carga: la concurrencia ya se cubre con las pruebas de 24 reservas simultáneas y
  4B1-06. No hay un banco de carga sostenida.

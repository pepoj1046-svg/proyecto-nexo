# Paquete de transferencia — Trufis Bolivia (Proyecto Nexo)

Etapa 10A. Estado: **borrador para revisión del propietario**. Este paquete permite que un
comprador instale, opere, verifique y acepte el **laboratorio**. **No es una entrega para
producción**: la aptitud productiva exige las habilitaciones que figuran en
[ACEPTACION_ETAPA_9.md](../ACEPTACION_ETAPA_9.md) y los riesgos R1–R8 de la
[revisión de amenazas](../REVISION_AMENAZAS_ETAPA_8.md).

## Contenido

| Documento | Para qué sirve |
| --- | --- |
| Este archivo, secciones 1–5 | Instalación, primer acceso, operación diaria, actualización y respaldo |
| [DEPENDENCIAS_Y_LICENCIAS.md](DEPENDENCIAS_Y_LICENCIAS.md) | Inventario reproducible de dependencias y licencias |
| [CAPACITACION.md](CAPACITACION.md) | Guía breve por rol para la demostración y la capacitación |
| [ACTA_DE_ACEPTACION.md](ACTA_DE_ACEPTACION.md) | Plantilla de acta de aceptación del laboratorio |
| [../DECISIONES_PROVISIONALES.md](../DECISIONES_PROVISIONALES.md) | Decisiones de negocio que el comprador debe ratificar o corregir |
| [../ACEPTACION_ETAPA_9.md](../ACEPTACION_ETAPA_9.md) | Qué está cumplido, qué es simulado y qué no está implementado |

## 1. Instalación del laboratorio

**Requisitos:** Windows 10/11 o Linux x64, **Node.js 22 o 24**, Git y unos 2 GB libres (para
PostgreSQL embebido y Chromium). No hace falta instalar PostgreSQL: el laboratorio lo
descarga como dependencia de desarrollo.

```bash
git clone https://github.com/pepoj1046-svg/proyecto-nexo
cd proyecto-nexo
npm ci --no-fund
```

- **npm 11 o posterior** puede no ejecutar los scripts de instalación de `esbuild` y
  `@embedded-postgres/*` («install scripts not yet covered by allowScripts»). Revísalos con
  `npm install-scripts ls`, apruébalos y vuelve a ejecutar `npm ci`. Sin ellos no compila
  la web ni arranca PostgreSQL.
- **Windows (PowerShell):** si `npm` dice que la ejecución de scripts está deshabilitada,
  ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`,
  o usa `npm.cmd`.
- Trabaja en una carpeta propia (por ejemplo `C:\Users\<usuario>\Proyectos`), nunca en
  `C:\Windows\System32`.

Para las pruebas E2E instala además el navegador: `npx --no-install playwright install chromium`.

## 2. Primer acceso y arranque

```bash
npm run dev:web
```

- Crea un PostgreSQL nuevo en `.local/`, aplica todas las migraciones, carga datos
  **ficticios** y muestra la dirección `http://127.0.0.1:<puerto>` y la ruta de
  `.local/accesos-<identificador>.json`, con los usuarios y contraseñas de prueba.
- **Cada arranque empieza de cero:** los datos desaparecen al detenerlo con Ctrl+C. Para
  conservarlos, haz un respaldo (sección 5) antes de detenerlo.
- Los archivos de `.local/` contienen contraseñas de prueba: no los compartas ni los subas a git.
- Para comprobar el estado, abre `GET /api/health`: debe responder `database: "up"` y
  la última migración.

## 3. Operación diaria (laboratorio)

| Tarea | Dónde |
| --- | --- |
| Buscar y reservar | Inicio → «Buscar viaje» |
| Reservas, avisos y valoraciones del pasajero | «Mis reservas» |
| Filas, salidas, incidencias y registro presencial del chofer | «Chofer» |
| Horario sin personal, directorio, valoraciones y conciliación | «Administración» |
| Asociaciones y verificaciones (administración general) | «Plataforma» |
| Ayuda por rol | «Ayuda» |
| Preferencias de interfaz | «Mi cuenta» |

## 4. Actualización

```bash
git pull
npm ci --no-fund
npm run db:migrate   # en una base persistente; el laboratorio migra solo al arrancar
```

- Las migraciones son **aditivas y numeradas**, y una vez aplicadas **nunca se editan**. El
  registro `public.nexo_migrations` guarda el checksum de cada una: si un archivo aplicado
  cambia, `MIGRATION_CHECKSUM_MISMATCH` detiene la actualización.
- Antes de actualizar una base con datos que importan, haz un respaldo.

## 5. Respaldo y restauración

```bash
MIGRATION_DATABASE_URL=postgres://… node scripts/lab-backup.mjs backup  .local/respaldo.json
MIGRATION_DATABASE_URL=postgres://… node scripts/lab-backup.mjs restore .local/respaldo.json
```

- El respaldo es lógico (JSON), con un checksum por tabla. No sobrescribe archivos y se crea
  con permisos 600.
- La restauración exige una base **vacía**: la migra y verifica el checksum de cada tabla.
  Si algo no coincide, se detiene.
- El archivo contiene hashes de contraseñas ficticias: trátalo como un secreto.

## 6. Pruebas

```bash
npm test               # unitarias
npm run test:all       # unitarias, PostgreSQL embebido y API local
npm run test:web       # E2E de escritorio y móvil (Chromium)
```

El CI de GitHub ejecuta lo mismo en Ubuntu y Windows con Node 22 y 24, más CodeQL, en
cada PR hacia `main` o `desarrollo/**`.

## 7. Lo que el comprador debe decidir antes de producción

Debe decidir: proveedor de pagos (QR), proveedor de avisos (SMS, correo o push), GPS,
licencias por asociación, infraestructura y presupuesto, política de privacidad, titularidad
y licencia del código propio, soporte posterior, y las decisiones provisionales del
registro. Ninguna está resuelta en este paquete.

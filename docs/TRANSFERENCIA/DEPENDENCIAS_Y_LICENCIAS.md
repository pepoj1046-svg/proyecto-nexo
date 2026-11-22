# Dependencias y licencias (etapa 10A)

Inventario generado desde `package-lock.json`. Para regenerarlo, ejecuta
`node scripts/license-inventory.mjs`. La prueba `10A-U1` exige que todos los paquetes
declaren una licencia y que **ninguna dependencia de producción sea copyleft fuerte**
(GPL, AGPL, SSPL, EUPL u OSL).

**Resumen:** 63 paquetes bloqueados, 17 de producción y 46 de desarrollo.
Licencias: Apache-2.0 (4), ISC (2), MIT (55), MPL-2.0 (2).

## Notas para el comprador

- **Producción:** solo `pg` y sus dependencias, y `react` / `react-dom`, todas con licencias
  permisivas (MIT o ISC).
- **MPL-2.0** (`axe-core`, `@axe-core/playwright`): solo se usan en pruebas de accesibilidad.
  No se distribuyen con la aplicación.
- **`embedded-postgres`** (MIT) descarga binarios de **PostgreSQL** (PostgreSQL License,
  permisiva) **solo para el laboratorio y las pruebas**. En producción se usaría un PostgreSQL
  gestionado por el comprador.
- **Playwright** (Apache-2.0) descarga navegadores (Chromium) **solo para las pruebas E2E**.
- **Código propio:** `package.json` declara `"private": true` y el repositorio **no tiene
  archivo LICENSE**. La titularidad y la licencia del código propio deben acordarse por
  contrato en la venta (decisión de las partes, fuera del alcance técnico).
- **Pendiente para un despliegue real:** generar un SBOM formal (CycloneDX o SPDX) con
  la herramienta que elija el comprador, e incluir los avisos de terceros de los binarios
  que se distribuyan.

## Inventario

| Paquete | Versión | Licencia | Uso | Opcional |
| --- | --- | --- | --- | --- |
| @axe-core/playwright | 4.11.1 | MPL-2.0 | desarrollo | no |
| @embedded-postgres/darwin-arm64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/darwin-x64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/linux-arm | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/linux-arm64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/linux-ia32 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/linux-ppc64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/linux-x64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @embedded-postgres/windows-x64 | 18.4.0-beta.17 | MIT | desarrollo | sí |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/android-arm | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/android-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/android-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/darwin-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-arm | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-ia32 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-loong64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-mips64el | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-s390x | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/linux-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/sunos-x64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/win32-arm64 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/win32-ia32 | 0.28.2 | MIT | desarrollo | sí |
| @esbuild/win32-x64 | 0.28.2 | MIT | desarrollo | sí |
| @playwright/test | 1.64.1 | Apache-2.0 | desarrollo | no |
| @types/react | 19.3.0 | MIT | desarrollo | no |
| @types/react-dom | 19.3.0 | MIT | desarrollo | no |
| async-exit-hook | 2.0.1 | MIT | desarrollo | no |
| axe-core | 4.11.4 | MPL-2.0 | desarrollo | no |
| csstype | 3.2.3 | MIT | desarrollo | no |
| embedded-postgres | 18.4.0-beta.17 | MIT | desarrollo | no |
| esbuild | 0.28.2 | MIT | desarrollo | no |
| playwright | 1.64.1 | Apache-2.0 | desarrollo | no |
| playwright-core | 1.64.1 | Apache-2.0 | desarrollo | no |
| typescript | 5.9.3 | Apache-2.0 | desarrollo | no |
| pg | 8.23.1 | MIT | producción | no |
| pg-cloudflare | 1.4.1 | MIT | producción | sí |
| pg-connection-string | 2.14.1 | MIT | producción | no |
| pg-int8 | 1.0.1 | ISC | producción | no |
| pg-pool | 3.14.0 | MIT | producción | no |
| pg-protocol | 1.16.1 | MIT | producción | no |
| pg-types | 2.2.0 | MIT | producción | no |
| pgpass | 1.0.5 | MIT | producción | no |
| postgres-array | 2.0.0 | MIT | producción | no |
| postgres-bytea | 1.0.1 | MIT | producción | no |
| postgres-date | 1.0.7 | MIT | producción | no |
| postgres-interval | 1.2.0 | MIT | producción | no |
| react | 19.3.1 | MIT | producción | no |
| react-dom | 19.3.1 | MIT | producción | no |
| scheduler | 0.28.0 | MIT | producción | no |
| split2 | 4.2.0 | ISC | producción | no |
| xtend | 4.0.2 | MIT | producción | no |

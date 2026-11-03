---
name: nexo-pruebas
description: "Seleccionar, ejecutar y reportar pruebas unitarias, PostgreSQL de integración, React/Playwright E2E y regresiones en Nexo. Usar cuando se altera comportamiento, SQL, UI, runner o CI."
---
# Nexo: pruebas proporcionales
1. Revisar package.json, scripts/test-postgres.mjs, scripts/test-web.mjs y workflows existentes; no inventar comandos.
2. Delimitar impacto; ejecutar pruebas dirigidas primero; después, para cambios de producto estabilizados, npm run test:all y npm run test:web cuando el entorno lo permita.
3. Separar definiciones E2E de ejecuciones por desktop/mobile y de repeticiones/OS. Informar cifras exactas, exit codes y pruebas no ejecutadas.
4. Comprobar PostgreSQL efímero, cierre de listeners y limpieza de clústeres propios **inactivos**, jamás bases activas.
5. Mantener límites y retries; cualquier fallo Windows/Chromium debe preservarse y diagnosticarse, no ocultarse.
6. Para cambios solo Markdown no ejecutar matrices pesadas sin motivo; si afecta SKILL.md verificar formato y descubrimiento en Codex cuando esté disponible.

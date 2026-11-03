# Diagnóstico y configuración segura de Agent Skills — Nexo
Fecha: 2026-11-03. Base de auditoría: 6b74f40e0cbe60355968ae9828560a2fa6b43d62. Alcance solo documentación/instrucciones, sin cambiar aplicación.

## Inventario anterior
- Existía `.agents/skills/trufis-dev/SKILL.md`, compatible con frontmatter `name` y `description`.
- Existían `AGENTS.md`, `.codex/config.toml` y dos perfiles `.codex/agents/*.toml`. Se conservaron sin cambios.
- Nexo usa PostgreSQL local para el laboratorio, no Supabase como backend vigente. No se accedió a bases de datos ni se instalaron paquetes.

## Archivos añadidos
Seis skills de instrucciones: `nexo-seguridad`, `nexo-base-datos`, `nexo-calidad`, `nexo-pruebas`, `nexo-arquitectura`, `nexo-auditoria`, cada una en `.agents/skills/<nombre>/SKILL.md`. Se activan por su descripción o al invocarlas explícitamente, sin hooks ni comandos automáticos.

## Herramientas externas: evaluación, no instalación
- **Graphify**: repositorio Graphify-Labs/graphify existente; licencia Apache-2.0 y archivo MIT complementario observados en su repositorio. Python >=3.10; CLI PyPI `graphifyy` (doble y), requiere dependencias tree-sitter/networkx. Se anuncia instalación Codex con `graphify install --project --platform codex`. Solo el análisis de código `graphify extract . --code-only` con `GRAPHIFY_BACKEND=none` evita la pasada semántica externa según documentación; los documentos pueden ir a un LLM con otras opciones. Cloud ofrece prueba, no asumida gratuita indefinidamente. **No instalado ni ejecutado**: se requiere revisar versión/dependencias/suministro antes de prueba efímera y permiso del propietario antes de instalación o salida de datos.
- **Ponytail**: repositorio DietrichGebert/ponytail, licencia MIT; instrucciones y hooks opcionales. Sus porcentajes de reducción son benchmarks del autor en Claude Code, no evidencia de ahorro en Codex/Nexo. No instalado para evitar interferencia con AGENTS.md y ganchos.
- **OmniRoute**: repositorio cheaper-inference/OmniRoute, licencia MIT; gateway de proveedores/modelos que exige configuración/custodia de claves y puede dirigir prompts/código a proveedores externos. Fuera del alcance inicial, sin instalación ni cambios de autenticación.
- **Agent Skills oficiales**: carpetas con `SKILL.md` y metadatos YAML en `.agents/skills/`; lectura bajo demanda según la descripción. Esta incorporación no exige npm/pip ni servicios.

## Verificación y límites
- Validación estática del frontmatter y rutas mediante lectura del árbol publicado: pendiente de confirmar tras commit.
- Reconocimiento efectivo en la sesión Codex Cloud/CLI: pendiente de comprobar desde su entorno (p. ej. selector de skills o invocación explícita).
- No hubo ejecución de Graphify ni pruebas npm/PG/E2E: solo se añadieron instrucciones sin cambios funcionales.
- No se han alterado `AGENTS.md`, perfiles TOML, workflows, lockfile, migraciones, claves, PostgreSQL, ni código operativo.
- Para probar Graphify después: fijar revisión/version, auditar `pyproject.toml`/lock y scripts de instalación; usar clon efímero sin secretos y `--code-only`, backend desactivado, red restringida, salidas no versionadas. Validar qué archivos ignora y si el gráfico agrega valor antes de crear integración permanente.
- Mantener este trabajo en PR separado, no fusionado. No implica iniciar Etapa 5.

# Protocolo de coordinación ChatGPT + Codex

**Proyecto:** Trufis Bolivia / `proyecto-nexo`. **Estado:** modo de trabajo propuesto, no automatización activa entre chats.

## Responsabilidades

- **Codex — implementación:** leer `AGENTS.md` y documentos de etapa; construir incrementos pequeños, ejecutar pruebas, escribir reportes y trabajar en ramas / PRs de revisión.
- **ChatGPT — planificación y revisión:** revisar los cambios y resultados **cuando se le solicite o se ejecute una comprobación programada**; publicar observaciones e instrucciones usando los archivos del repositorio o comentarios de PR si los permisos lo permiten.
- **Propietario — decisiones reservadas:** aceptar gastos o servicios de pago, conectar cuentas bancarias y GPS real, aprobar cambios sustanciales del modelo comercial, dar acceso a secretos, fusionar a `main` o lanzar un piloto real.

## Intercambio de información

GitHub es la única fuente de coordinación compartida. No asumir que un chat conoce el contenido de otro.

Codex debe incluir en su PR o en `docs/REPORTES/`:
1. Objetivo e identificador de la etapa.
2. Cambios y rutas modificadas.
3. Comandos y resultados **reales** de las pruebas.
4. Fallos, riesgos, incompatibilidades y deuda técnica.
5. Preguntas que requieren decisión del propietario.
6. Próximo incremento propuesto.

ChatGPT revisará reportes, código, diferencias y ejecuciones CI; distinguirá pruebas ejecutadas de las pendientes; y publicará instrucciones accionables en GitHub cuando sea posible.

## Ciclo recomendado sin intervención constante

1. Una sola asignación de Codex puede abarcar varios incrementos de la etapa, siempre que los tests se ejecuten entre incrementos.
2. Cada incremento debe producir commits verificables y actualizar el PR o informe.
3. Al revisar, ChatGPT aprueba técnicamente, devuelve observaciones o señala un bloqueo real; **no fusiona** a `main` sin autorización explícita.
4. Codex corrige observaciones y documenta nueva evidencia.
5. El propietario solo interviene ante decisiones comerciales, cambios irreversibles, servicios externos/gastos, información real o aprobación del lanzamiento.

## Límites de autonomía y costes

- Codex **no conversa automáticamente con ChatGPT**, ni ChatGPT recibe notificaciones de sus tareas por defecto. Un usuario o mecanismo programado explícitamente debe iniciar cada revisión.
- GitHub Actions puede ejecutar **pruebas previamente configuradas** tras cada push y PR; esto no equivale a lanzar nuevas tareas de Codex.
- No realizar despliegues, borrar datos, manipular cuentas o contratar servicios sin consentimiento.
- Mantener intactos Ruta 35, Meteo Chaco, ATLAS-AI-Lab; `main` requiere revisión.
- Los informes y el historial de GitHub son el punto de reanudación si se interrumpe la sesión o se agota cuota.

## Estado inicial

Rama `desarrollo/etapa-1`; PR #1 en borrador. Etapa 1 requiere migraciones PostgreSQL reproducibles, aislamiento multi-asociación verificable, control concurrente de cupos y tests de integración. El esquema original es un borrador, no apto para producción.

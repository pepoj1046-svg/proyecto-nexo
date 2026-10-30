---
name: trufis-dev
description: "Desarrollar, revisar o probar Proyecto Nexo (Trufis Bolivia): reservas, capacidad por segmentos, filas, terminales, recorridos, incidencias, sustituciones, rescates, roles y seguridad. Usar al trabajar en pepoj1046-svg/proyecto-nexo; no usar para proyectos ajenos."
---

# Trufis Bolivia — procedimiento de desarrollo seguro

1. Confirmar el repositorio exacto `pepoj1046-svg/proyecto-nexo`, rama de trabajo y `git status`. No tocar Ruta 35, Meteo Chaco ni ATLAS. No editar `main`, fusionar PR, desplegar ni iniciar un incremento no autorizado.
2. Leer `AGENTS.md`. Según la tarea, consultar selectivamente `docs/REQUISITOS_INICIALES.md`, `docs/ARQUITECTURA.md`, `docs/MODELO_DE_DATOS.md`, `docs/SEGURIDAD_PENDIENTE.md`, `docs/PRUEBAS_ETAPA_1.md`, informes `docs/REPORTES/ETAPA_2_*.md`, `ETAPA_3_*.md` y contratos pertinentes. No leer todo indiscriminadamente en cada tarea.
3. Antes de programar, delimitar objetivo, módulos y tests afectados; comprobar si la función ya existe. Reutilizar RPC, modelos y componentes probados; no construir inventarios o fuentes de verdad paralelos.
4. Invariantes: máximo seis pasajeros simultáneos por vehículo **en cada segmento** del piloto, no seis reservas acumuladas a lo largo de toda la ruta. Mantener grupos juntos salvo consentimiento y contrato explícito; filas, cupos futuros, precios/versiones acordados y confirmación por actor legítimo. Seis plazas confirmadas no equivalen a salida ni abordaje; registrar acciones observadas explícitas.
5. Seguridad: verificar actor y alcance real de asociación, ruta, terminal, vehículo y reserva en servidor; mantener RLS, aislamiento de pasajeros, sesiones revocables, CSRF, auditoría, idempotencia y control de carreras. No confiar en IDs, roles o estados enviados por el navegador. No exponer datos de terceros.
6. Incidencias: no prometer rescate sin vehículo apto, totalmente libre y autorizado de la misma asociación; respetar terminal de procedencia, consentimiento cuando corresponda y traslado seguro registrado. Rechazos sin cambios parciales. No inventar plazos, sanciones, asistencia, rutas con desvíos o decisiones comerciales.
7. Ciclo eficiente: usar búsquedas acotadas a módulos; ejecutar tests dirigidos primero, corregir y repetir esos tests. Antes de entregar: `npm run test:all` y `npm run test:web`, compilación y revisión de CI si está disponible. No declarar aprobada una prueba que no se ejecutó; contar correctamente casos por entorno y reportar fallos intermedios resueltos.
8. Solo laboratorio local y datos ficticios; sin pagos, GPS real, OAuth, avisos externos, publicación, credenciales ni servicios de pago sin permiso expreso. No introducir archivos privados de `.local` en Git.
9. Entrega breve: resumen, archivos afectados, commits/PR, pruebas ejecutadas con resultados exactos, evidencia CI, riesgos y pasos mínimos para Windows. Distinguir validación automatizada de prueba manual y de aprobación para producción.

Esta skill complementa `AGENTS.md` y los contratos; si hay conflicto, aplicar la instrucción vigente más restrictiva y señalar la discrepancia.

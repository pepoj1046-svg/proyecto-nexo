# Instrucciones para Codex — Proyecto Nexo (Trufis Bolivia)

## Alcance y aislamiento
Trabaja **solo** en este repositorio, `pepoj1046-svg/proyecto-nexo`. Nunca uses, modifiques ni migres código, bases, recursos, credenciales ni despliegues de Ruta 35, Meteo Chaco o ATLAS-AI-Lab. El repositorio es **público**: no incluir secretos, datos personales reales o credenciales en commits, logs o PRs.

## Flujo de desarrollo
- Rama principal protegida por convención: no hacer push ni merge directo a `main`.
- Etapa 1 de laboratorio aceptada por el propietario; trabajar en **Etapa 2**,
  rama `desarrollo/etapa-2` desde el último commit de `desarrollo/etapa-1`.
- PR independiente hacia `desarrollo/etapa-1`; no fusionar ni cerrar PR #1.
- Solo datos ficticios y entorno local. No iniciar Etapa 3, aplicaciones móviles,
  integraciones bancarias, GPS real ni despliegues.
- Conservar 001–015 intactas; nuevas migraciones desde 016. Reutilizar el núcleo
  transaccional probado y documentar decisiones de negocio pendientes por separado.
- Antes de editar, leer `docs/REQUISITOS_INICIALES.md`, `docs/ARQUITECTURA.md`, `docs/MODELO_DE_DATOS.md`, `docs/SEGURIDAD_PENDIENTE.md` y `docs/PRUEBAS_ETAPA_1.md`.
- Implementar incrementos pequeños con pruebas automatizadas reproducibles. Documentar cómo ejecutar cada prueba y su salida.
- Si detectas una inconsistencia en los requisitos, deja propuesta/nota y detén solo esa parte; no cambies decisiones comerciales por tu cuenta.
- Mantener el modelo inicial de 6 plazas de pasajeros por vehículo en el piloto, sin asumir aplicabilidad a todos los vehículos reales.
- No consumir servicios de pago ni habilitar facturación sin consentimiento específico.

## Prioridades de Etapa 1
1. Elegir herramienta de migraciones PostgreSQL compatible con un entorno local reproducible, crear migración inicial **idempotente vía registro de migraciones**, no ejecutar el DDL de borrador a ciegas.
2. Implementar pertenencia a asociación y autorizaciones verificadas en servidor, y protección de datos con RLS cuando corresponda. **No confiar en IDs de asociación enviados por cliente**.
3. Endurecer claves foráneas cruzadas para impedir conectar una reserva de A con vehículo/ruta/conductor de B.
4. Inventario de plazas **por segmentos**, con transacciones, bloqueo adecuado y claves de idempotencia. Reservas simultáneas nunca deben vender más capacidad real.
5. Preparar tests de integración PostgreSQL locales: accesos cruzados, capacidad concurrente, reservas de grupos voluntariamente divididos, filas y salida; conservar tests unitarios.
6. Validar CI de GitHub Actions para tests que no requieran credenciales; no publicar datos de test personales.

## Definición de terminado
- Código + documentación + comandos de instalación/ejecución.
- Ejecutadas y aprobadas pruebas automatizadas locales y CI disponibles.
- Verificar permisos de lectura y escritura de asociación A vs B.
- Verificar carrera de reservas simultáneas, 6 plazas máximas en cada segmento.
- Sin cambios a `main` ni despliegues; PR listo para revisión, no fusionado.

## Entrega
Resume archivos cambiados, decisiones, pruebas (con resultados exactos), riesgos pendientes y enlace al PR. Declara cualquier prueba no ejecutada como pendiente.

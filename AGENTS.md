# Instrucciones para Codex — Proyecto Nexo (Trufis Bolivia)

## Alcance y aislamiento
Trabaja **solo** en este repositorio, `pepoj1046-svg/proyecto-nexo`. Nunca uses, modifiques ni migres código, bases, recursos, credenciales ni despliegues de Ruta 35, Meteo Chaco o ATLAS-AI-Lab. El repositorio es **público**: no incluir secretos, datos personales reales o credenciales en commits, logs o PRs.

## Flujo de desarrollo
- Rama principal protegida por convención: no hacer push ni merge directo a `main`.
- Estas instrucciones aplican a cualquier agente (Codex, Claude u otro) que trabaje en el repositorio.
- Etapas 1–3 cerradas técnicamente en laboratorio y Etapa 4A con cierre técnico de laboratorio (PR #5), sin habilitación productiva.
- Etapa 5 integrada en `main` hasta 5A.4-B3 (17-11-2026, `89ec522`). 4B.1 (registro presencial por el chofer) en el
  PR #18, auditado y pendiente de ratificación.
- **Autorización vigente (21-11-2026):** el propietario encargó a Claude completar 5A.5–5A.8 y las etapas 6–10 en
  laboratorio, tomando las decisiones de negocio necesarias como **provisionales**, documentadas en
  `docs/DECISIONES_PROVISIONALES.md`, para revisarlas al final. No autoriza fusionar en `main`, desplegar, usar datos
  reales, dinero real ni servicios de pago. El estado de trabajo y el prompt de reanudación están en `docs/CONTINUIDAD.md`.
- Cada incremento parte del SHA del anterior, en rama propia, con PR en borrador hacia la rama del incremento
  anterior; nunca desde una `main` antigua. No fusionar, cerrar ni modificar PRs ajenos al encargo sin autorización.
- El CI corre en todo PR hacia `main` o `desarrollo/**`.
- Solo web adaptable, PostgreSQL local y datos ficticios; sin aplicaciones nativas,
  bancos, GPS real, comunicaciones externas ni despliegues.
- Conservar intactas las migraciones ya integradas; cada migración nueva es la siguiente numerada, aditivas y exclusivas de su incremento. Sin privilegios
  operativos globales ni otro inventario. Reutilizar el núcleo transaccional y documentar decisiones pendientes.
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

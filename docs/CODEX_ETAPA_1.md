# Encargo de desarrollo para Codex — Etapa 1

Repositorio: `pepoj1046-svg/proyecto-nexo`
Rama de partida: `desarrollo/etapa-1`
PR existente: https://github.com/pepoj1046-svg/proyecto-nexo/pull/1

## Objetivo
Llevar el prototipo de Etapa 1 desde el esquema conceptual y funciones puras actuales a un backend mínimo con datos ficticios, migraciones PostgreSQL reproducibles, seguridad multi-asociación y pruebas de concurrencia.

## Tareas priorizadas
1. Revisar en detalle el código existente y anotar lagunas de seguridad/dominio.
2. Crear migraciones PostgreSQL reproducibles y scripts para preparar una DB de pruebas **local**, sin crear cuentas o proyectos en la nube.
3. Modelar relaciones compuestas y comprobaciones de permisos de asociación; no permitir asociaciones cruzadas ni que un cliente cambie su ámbito.
4. Implementar transacciones de inventario por segmentos, incluyendo pasajeros presenciales y digitales, y prevención de doble confirmación.
5. Añadir pruebas de concurrencia real PostgreSQL y de los permisos, sin depender de bancos ni sistemas externos.
6. Ejecutar pruebas; publicar resumen con comandos y evidencia.
7. Mantener PR de Etapa 1 sin merge y documentar pendientes.

## No permitido en este encargo
- Desplegar, crear Supabase u otro proyecto remoto, pagar hosting o habilitar servicios de terceros.
- Usar datos reales de usuarios, pagos QR reales o GPS personal.
- Cambiar requisitos comerciales del servicio, ni mezclar los repositorios anteriores.
- Fusionar cambios sin revisión.

## Criterios para aceptar
- Protección demostrada de asociación A/B.
- Capacidad por tramo nunca superior a seis en concurrencia.
- Pruebas unitarias e integración pasando y repetibles.
- Archivos de esquema/migración consistentes, descripción de riesgos remanentes.

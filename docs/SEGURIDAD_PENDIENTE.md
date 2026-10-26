# Seguridad y límites del prototipo

Este repositorio aún **no** cuenta con backend autenticado ni RLS activado.

## Bloqueos previos a conectar una base real
1. Añadir y probar políticas RLS o aislamiento equivalente con asociación contextual validada (el cliente jamás decide el ID de asociación autorizado).
2. Endurecer el esquema: referencias compuestas entre reservas, asignaciones y vehículos, validación de membresía del chofer, reglas para ofertas rechazadas y expiradas, y un único viaje activo por vehículo.
3. Agregar transacciones PostgreSQL con bloqueo de fila o serialización y reintento idempotente para reservas simultáneas. Las funciones puras de `src/domain/dispatch.mjs` **NO** sustituyen estos bloqueos.
4. Incorporar disponibilidad por segmentos geográficos versionados y retenciones temporales.
5. Probar concurrencia real de PostgreSQL y permisos cruzados con varios usuarios ficticios.
6. Mantener credenciales fuera del repositorio y usar un entorno aislado de pruebas.
7. El código `canDepart` ejemplifica salida con seis plazas en primer segmento; antes de utilizarlo con recogidas en carretera, definir salida con plazas reservadas a recoger más adelante sin superar capacidad.

## Alcance actual
La CI ejecuta pruebas unitarias puras (sin red, sin secretos). Superar esas pruebas no significa que haya seguridad multiusuario ni un sistema funcional desplegado.

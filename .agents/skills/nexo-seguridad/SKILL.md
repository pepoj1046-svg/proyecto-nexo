---
name: nexo-seguridad
description: "Auditar autenticación, sesiones, permisos de asociación/ruta, RLS, CSRF y privacidad en Nexo. Usar ante cambios de identidad, APIs, SQL privilegiado o acceso a datos; no usar para tareas solo visuales."
---
# Nexo: revisión de seguridad
1. Leer AGENTS.md y .agents/skills/trufis-dev/SKILL.md; identificar contratos afectados. Solo repo Nexo, laboratorio ficticio.
2. Trazar navegador → gateway → servicio → RPC → tablas/RLS. SQL debe derivar actor y ámbito de sesión, no de parámetros del cliente.
3. Comprobar AUTHN/AUTHZ, RLS/GRANT, SECURITY DEFINER/search_path, revocación/caducidad tras esperas, CSRF/Origin, idempotencia/ABA, auditoría/rollback y aislamiento entre asociaciones.
4. Probar negativas: ADMIN ajeno/limitado, GENERAL_ADMIN sin bypass, REVIEWER, DRIVER, pasajero, sesión revocada, cambio concurrente. No exponer secretos, PII ni credenciales.
5. Nexo usa PostgreSQL local real; **no asumir Supabase**. Si se evalúa una integración futura, no tocar Supabase sin autorización específica.
6. Informar hallazgo con archivo, reproducción, impacto, severidad, prueba y límite. No declarar certificado de producción ni activar servicios.

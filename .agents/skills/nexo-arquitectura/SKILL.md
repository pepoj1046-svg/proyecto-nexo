---
name: nexo-arquitectura
description: "Entender trazabilidad y dependencias entre frontend React, gateway HTTP, servicios Node, RPC PostgreSQL y documentación de Nexo. Usar antes de cambios transversales o para evaluar impacto de módulos."
---
# Nexo: mapa de arquitectura
1. Leer AGENTS.md, docs/ARQUITECTURA.md y solo los contratos de la tarea.
2. Trazar explícitamente UI → API → servicio → SQL → tablas y eventos, indicando archivo/función y dependencias demostradas.
3. Distinguir capas de consulta de las fuentes de verdad: PostgreSQL y recibos, sin inventarios paralelos.
4. Identificar superficies sensibles: sesión, RLS, asociación, reservas por segmento, tarifas históricas, custodia, rescates y administradores.
5. Preferir búsquedas locales acotadas y documentación existente. Graphify es **opcional, no instalado**; usarlo solo si se revisó su versión y se autorizó la ejecución local sin salida de código ni servicios de pago.
6. Devolver mapa concreto de módulos, puntos de cambio, riesgos y test de cada frontera; no presentar hipótesis como relaciones confirmadas.

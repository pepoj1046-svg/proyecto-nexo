---
name: nexo-base-datos
description: "Revisar PostgreSQL, migraciones, integridad y concurrencia de reservas, usuarios, vehículos, rutas, tarifas y custodia en Nexo. Usar al cambiar SQL, RPC, esquema o inventario por segmentos."
---
# Nexo: integridad de datos
1. Consultar AGENTS.md, MODELO_DE_DATOS.md y contratos de la operación; identificar última migración en la rama real. No editar migraciones históricas.
2. Mantener asociaciones aisladas; claves foráneas cruzadas válidas, seis plazas simultáneas por segmento, un inventario APP/presencial y precios pactados/versiones inmutables.
3. Revisar locks, transacciones, idempotencia, reautorización tras espera, recibos y secuencias de carrera; conservar grupos, FIFO, abordajes y custodia.
4. Ejecutar pruebas PostgreSQL dirigidas existentes y de actualización limpia/poblada cuando aplique. Ninguna escritura sobre bases ajenas o reales.
5. Si hay SQL nuevo, migración aditiva siguiente a la última existente, con regresión y rollback; registrar objetos/grants/OID que se deben conservar.
6. Reportar invariantes comprobadas, pruebas ejecutadas, riesgos y preguntas contractuales no resueltas.

---
name: nexo-auditoria
description: "Auditar entregas, PR, regresiones, CI y trazabilidad de cambios en Nexo. Usar al cerrar incrementos, revisar seguridad y documentar estado de laboratorio para transferencia."
---
# Nexo: auditoría de entrega
1. Identificar rama, SHA exacto, diff, alcance autorizado y PR; no fusionar ni iniciar otra etapa.
2. Corroborar contratos y migraciones intactas, permisos, reservas, tarifas, FIFO, seis plazas por segmento, grupos, incidentes, menores y custodia.
3. Comparar pruebas reales y CI/CodeQL del mismo SHA; distinguir resultados locales de remotos, casos distintos de ejecuciones y avisos de hallazgos.
4. Registrar fallos intermedios, correcciones, evidencias, riesgos bloqueados y decisiones del comprador. No borrar ni publicar archivos privados.
5. Entregar estado APROBADO/NO APROBADO **solo en laboratorio** con pruebas reproducibles; nunca certificar producción, legalidad o comercialización sin evidencia.

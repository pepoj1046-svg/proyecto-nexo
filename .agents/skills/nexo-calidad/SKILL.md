---
name: nexo-calidad
description: "Revisar calidad, complejidad, mantenimiento y duplicaciones en JavaScript, TypeScript, React y scripts de Nexo. Usar en refactorización o revisión de diff; no imponer refactors sobre cambios funcionales estables."
---
# Nexo: calidad mínima necesaria
1. Acotar los archivos del diff y trazar sus consumidores antes de proponer cambios.
2. Preferir las funciones/servicios/componentes probados; evitar gateways, modelos, inventarios, wrappers o dependencias duplicadas.
3. Revisar validación de fronteras, tipos, errores seguros, limpieza de recursos, accesibilidad y consistencia con Node22/24.
4. No sacrificar seguridad, pruebas o claridad por reducir líneas/tokens; cuantificar ahorro solo si se midió.
5. No instalar herramientas/dependencias, alterar lockfile o ejecutar scripts remotos sin autorización.
6. Entregar observaciones ordenadas por impacto, con archivo, evidencia, corrección mínima y tests afectados.

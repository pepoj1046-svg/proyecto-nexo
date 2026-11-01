# Trufis Bolivia — plan propuesto de Etapa 4

Fecha: 01/11/2026. Referencia: `1f07fd9cb69676258bf277a561d9e8aa711bacb2`.
**Diagnóstico de 4A; programación pendiente de autorización.**

## Objetivo y fronteras

Preparar administración autónoma para la futura empresa compradora, sin depender
de editar SQL propietario o fixtures. Reutilizar núcleo y pantallas operativas;
no construir otro inventario ni promover el gateway local a Internet.

Esta ejecución entrega este plan, el [plan maestro](PLAN_MAESTRO_10_ETAPAS.md) y el
[diagnóstico exacto](REPORTES/ETAPA_4A_DIAGNOSTICO.md). No añade SQL, API o React.
Las unidades de programación siguientes son propuestas. Etapas 5–10 no se inician.

Se conservan [operación](ETAPA_2_CONTRATOS.md) y [cuidados/revisiones](ETAPA_3_CUIDADOS_Y_REVISIONES.md):
turno directo terminal/expreso, aceptación solo donde corresponde fuera de terminal,
grupos, precio pactado, seis plazas simultáneas por segmento, observaciones físicas
y recepción segura separadas de reserva, revisión humana de ambigüedades.

**001–033 inmutables.** DDL futuro empezará en 034 o la siguiente versión libre
tras verificar la rama. No se crea ni reserva una migración ahora. Cambiar capacidad
exige revisar constraints, inventario, expreso, grupos y UI: fuera del primer corte.
Seis es la referencia de laboratorio, no obligación de todos los vehículos futuros.

## Autoridad y arquitectura recomendadas

| Capacidad actual | Autoridad real y límite |
|---|---|
| Pasajero | Cuenta y reservas autorizadas; registro sin asociación automática. Referencia de reserva sola no acredita responsabilidad. |
| DRIVER | Membresía activa y servicio legítimo; no alta de vehículo ni autoaprobación. |
| ASSOCIATION_ADMIN | Asociación propia y posibles ámbitos de ruta/terminal. Ámbito limitado no concede acciones de asociación completa. |
| operation_reviewers / REVIEWER | Revisión confiable de permisos y ciertos estados; no administrador general completo ni acceso universal a personas. |
| nexo_app / nexo_identity | Grupos técnicos del runtime y autenticación, pools separados; no roles elegibles en formularios. |
| nexo_provisioner | Provisión offline acotada de ADMIN/REVIEWER, ámbitos, recuperación y estado de identidad; nunca pool HTTP. |
| Propietario de migraciones | Instala esquema y fixture, puede alterar seguridad; nunca conexión de producto. DML de setup no es administración implementada. |

**No existe `GENERAL_ADMIN` como rol SQL o vista web.** Requiere contrato explícito
de facultades de plataforma, asociación objetivo, delegación y datos mínimos.
No convertir REVIEWER en superadministrador ni ADMIN en global. Resolver su
representación técnica mediante ADR aprobado, sin duplicar identidad/membresías.
El primer corte funciona con ASSOCIATION_ADMIN actual y deja esa decisión global
pendiente. El futuro administrador general no aprueba cada salida cotidiana.

## Bootstrap y recuperación

`seed-web-demo.mjs` crea datos ficticios con setup propietario, cerrado antes de
escuchar HTTP. No existe comando de bootstrap comercial ni `scripts/provision*`.
Documentar RPC offline actuales sobre sujeto comprobado: `provision_role`,
`configure_admin_scope`, `set_identity_active`, `provision_recovery`. La asociación
inicial aún se crea por DML propietario: no presentar ese camino parcial como
primer acceso autónomo resuelto.

Un futuro instalador necesitaría secreto inicial generado localmente, ejecución
explícita y única, transacción/auditoría del instalador, sin clave de fábrica ni
«primer registro obtiene ADMIN». Acordar primer/último administrador, delegación,
sustitución y recuperación; esas guardas de producto no existen hoy. No publicar
un endpoint de bootstrap ni entregar EXECUTE del provisionador al runtime.

## Cambios mínimos previstos por capa

| Capa | Reutilización | Cambio futuro acotado |
|---|---|---|
| SQL | Entidades/FKs/RLS, actor, scopes, locks, recibos y auditoría | Proyecciones paginadas mínimas; después RPC estrechos por caso aprobado. DDL aditivo solo si hace falta, sin DML a nexo_app. |
| Adaptador | Runtime validado, transacciones y parámetros | Servicio administrativo con lista cerrada; sin RPC/SQL elegidos por cliente ni conexión de provisión. |
| HTTP | Handler fijo autenticado y CSRF de web-gateway | Endpoints específicos, contratos cerrados, límites/errores seguros. Sus nombres se decidirán en implementación; no existen aún. |
| React | Sesión, formularios, páginas y operaciones existentes | Sección sin dependencia de viaje; carga/error/vacío, ámbito visible, móvil y teclado. No duplicar Care/Recovery/Conditions. |
| Auditoría | Bitácoras inmutables actuales | Historial de configuración por entidad, versión, actor, motivo y antes/después minimizados; sin secretos ni exportación universal. |

Autorizar cada página en servidor. El `associationId` recibido no acredita pertenencia;
la RLS del catálogo de búsqueda no es un directorio administrativo global. Crear
proyección mínima solo si las actuales no expresan el contrato, sin exponer pasajeros.

## Configuración sin reescribir historia

Proponer borrador → validación de impacto → publicación explícita con versión
esperada; **no es un flujo implementado**. Revalidar actor, ámbito y estado tras
esperar locks, en la misma transacción. Conservar orden compatible de locks de
ámbito/idempotencia/ruta; no introducir orden inverso al núcleo.

| Cambio futuro | Contrato necesario |
|---|---|
| Asociación y primer ADMIN | Alta auditada, autoridad de plataforma y recuperación aprobadas, sin autoasignación al registrar cuenta. |
| Membresía/ámbito | Diferenciar rol, identidad global y terminal. No mover asociación de datos históricos ni borrar reservas. |
| Baja de chofer durante servicio | La revocación actual impide operar. El nuevo flujo debe bloquear o remitir a procedimiento humano aprobado; no inventar continuidad, custodia ni sustitución automática. |
| Vehículo | No editar capacidad/asignación para eludir servicio, reservas o bloques. Reutilizar sustitución/rescate sin movimientos sintéticos. |
| Ruta/sentido/punto | Guardas protegen topología usada; otra versión/identidad sin trasladar reservas automáticamente. OUT/IN no es invertir índices a ciegas. |
| Tarifa | Publicación para nuevas solicitudes, solapes/vigencias/modalidad/segmentos validados, precio/versión pactados preservados. CRUD completo difiere del editor parcial de condiciones actual. |
| Suspensión | Separar status comercial, adhesión, operación, permiso, identidad y avería. No activar cancelaciones por impago/ausencia ni interrumpir custodia con un botón genérico. |
| Etiquetas | Varios listados hacen JOIN a nombres actuales; no existe snapshot universal de catálogo. Definir presentación retrospectiva antes de editar libremente. |

No eliminar entidades utilizadas ni afirmar que bajas lógicas/versionado universal
ya existen. No alterar precios o topología históricos para aparentar compatibilidad.

## Incrementos de programación propuestos

Las etiquetas 4A.1–4A.6 organizan esta propuesta; todas requieren autorización
posterior. No modifican la numeración de informes anteriores.

| Corte | Entregable y frontera | Complejidad / pruebas |
|---|---|---|
| **4A.1: directorio de lectura** | ADMIN consulta DRIVER existentes, vehículos incluso sin viaje, rutas/sentidos/puntos y tarifas; estados separados, ámbito, páginas >50. Guía del bootstrap actual y huecos. Sin escrituras/rol global nuevo. | Media: contratos, consultas/RLS, paginación y pocas E2E dirigidas por dispositivo. |
| 4A.2: controles existentes fuera del viaje | Revocar/restaurar DRIVER existente, contacto LAB y consultas de historial. Baja con servicio activo bloqueada/remitida hasta aprobar procedimiento. | Media/alta: reserva/salida concurrentes, sesión/ámbito, recibos y rollback. Sin alta inicial ni identidad global. |
| 4A.3: plataforma y asociaciones | Tras ADR de autoridad/bootstrap: revisión existente y luego alta de asociación/primer ADMIN aprobada. Sin equiparar adhesión a licencia o legalidad. | Alta: primer/último ADMIN, delegación, aislamiento y reintentos. |
| 4A.4: choferes y vehículos | Solicitud/revisión ficticia, padrón y asignación base segura; seis plazas y asociación estable. | Alta: estados de aprobación/disponibilidad y unidades ocupadas requieren contrato. |
| 4A.5: rutas y tarifas completas | Versiones de rutas, puntos/perfiles y tarifas ordinarias/expresas por segmento, vigencias y publicación. Puede dividirse en dos cortes. | Alta: actualización poblada, quotes concurrentes, topología e historia. |
| 4A.6: auditoría y aceptación | Historia autorizada paginada, instalación y escenarios de comprador; auditoría/cierre separado. | Media/alta: batería integral tras estabilización y CI de rama aprobada. |

Las partes independientes pueden continuar cuando un contrato esté bloqueado, sin
adelantar mutaciones no autorizadas. Complejidad no garantiza horas ni consumo de cuota.

## Primer encargo recomendado: únicamente 4A.1

Directorio administrativo paginado **solo lectura**, con el ADMIN actual. Ámbito
conservador por ruta/terminal; quien no tiene autoridad de asociación completa no
recibe padrón completo de personas. No crear un viaje para mostrar un vehículo libre.
Si un vehículo o miembro sin viaje no puede vincularse a una ruta autorizada del
administrador limitado, no inferir permiso: reservar esa consulta al ADMIN de
asociación con alcance completo y explicar la restricción en la interfaz.
Datos mínimos de acceso: ID técnico, membresía/estado y etiqueta ficticia; sin
credenciales/códigos ni vinculación por referencia.

Criterios: negar pasajero, chofer, ADMIN ajeno y sesión revocada; >50 filas sin
omisiones/duplicados; entidades sin viaje visibles solo cuando corresponda; cambio
de ámbito entre páginas; cero cambios a reservas, tarifas, cola, grupos, movimientos
o custodia. Verificar vacío/carga/error, teclado y móvil. SQL de lectura nuevo puede
requerir 034; autorizar esta consulta no aprueba CRUD ni un administrador global.

## Verificación futura y consumo de pruebas

Durante programación: unitarias de esquemas cerrados, PostgreSQL real dirigido y
E2E afectadas. A/B, ADMIN limitado, campos/roles inyectados, CSRF, expiración y
revocación al esperar lock. Para escrituras posteriores: dos administradores,
versión obsoleta, misma clave/payload, intención distinta, fallo de auditoría y rollback.

Si hay DDL: instalación limpia, upgrade poblado desde 033, comparación de historia,
reaplicación y hashes 001–033. Al estabilizar la entrega de código: batería completa,
TypeScript/web, escritorio/móvil; conservar 422 casos base y sumar nuevos. No aumentar
timeouts ni retries para ocultar fallos. No repetir matrices completas por cada edición.

CI requiere atención en el primer encargo de código: pruebas filtra ramas 1–3 y PR
hacia main/etapas 1–2; CodeQL filtra Etapa 3 y rutas de código. La rama nueva no queda
cubierta automáticamente. Proponer ajuste acotado para rama/base aprobadas, conservando
Ubuntu/Windows y Node22/24. No modificar filtros ni forzar matrices ahora por documentos.

## Decisiones y criterio de salida

Aprobar facultades de plataforma/revisor, primer/último ADMIN, delegación y recuperación;
alta técnica frente a validación legal; revocación en servicio; publicación/corrección
de rutas/tarifas/etiquetas; auditoría/exportación/retención; licencias comerciales
opcionales para el comprador. No fijar edades, documentos, plazos, multas o términos de venta.

Etapa 4 requerirá contratos aprobados implementados, operación sin fixtures manuales
para ese alcance, regresiones y cierre técnico separado. **Este plan no implementa
4A ni cierra Etapa 4.** Tras entregar el diagnóstico se espera autorización del
primer incremento; sin servicios, GPS, dinero, comunicaciones reales ni gastos.

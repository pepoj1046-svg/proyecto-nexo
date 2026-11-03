# Etapa 5, incremento 5A.2 — Recuperación segura de reservas APP

Estado: implementación de laboratorio para auditoría y revisión; **no cerrado**.
Autorización exclusiva del propietario posterior a 5A.1. No se inicia 5A.3 ni Etapa 6.
Repositorio `pepoj1046-svg/proyecto-nexo`, rama `desarrollo/etapa-5a2`.
Base funcional exacta: `6b74f40e0cbe60355968ae9828560a2fa6b43d62`.
Se copian únicamente plan/informe 5A.1 de `92a89e0`; no se fusionan PR anteriores.

## 1. Funciones implementadas y reutilizadas

- Máquina de recuperación por intento APP, en memoria: cuenta de la cotización,
  clave y cuerpo original clonados y congelados al confirmar, antes de esperar red.
- Estados separados de envío pendiente, resultado incierto, sesión requerida,
  recibo recibido, actualización fallida y consulta actualizada.
- Reenvío manual QUEUE/ENROUTE con la misma intención; no se recalculan tarifa,
  plazas, puntos, partes de grupo o consentimientos. Doble clic no crea otro envío.
- Recibo conservado aunque falle la lectura: una vez recibido, la recuperación
  repite únicamente consultas y no el POST de reserva.
- Consulta propia sin reenviar; su resultado no se interpreta como recibo de una
  clave ni prueba de rollback. La UI explicita primera página y total autorizado.
- Reautenticación de la cuenta original, comprobación de sesión y CSRF actual,
  descarte de respuestas privadas tardías ante cambio de cuenta/revocación.
- Reutilización de guardia SPA/historial/beforeunload y formulario montado de 4A.6,
  conservando sus controles administrativos y sus etiquetas anteriores.
- Mensajes accesibles, controles de recuperación manual en escritorio y móvil,
  explicación de HELD frente a confirmación, sin confundir reserva con salida.

[Contrato y comandos reproducibles](../ETAPA_5_RECUPERACION_RESERVAS.md).
Se mantienen API de reserva/cotización y listado propio, servicios de negocio,
recibos actor+clave y transacciones PostgreSQL existentes. No se necesita un
endpoint nuevo de recibos; no se abre `nexo.actions` a clientes.

## 2. Archivos y fronteras

- `apps/web/src/reservation-attempt.ts`: estado, congelación, comprobación de
  cuenta, respuesta válida, reenvío manual y consultas separadas.
- `apps/web/src/Functional.tsx`: integración en Checkout; conserva controles de
  grupos, importe y consentimiento, además de las consultas propias anteriores.
- `apps/web/src/admin-intent.ts`, `main.tsx`: reutilización de guardia/recuperación
  para reservas sin cambiar el flujo de comandos administrativos existente.
- `tests/reservation-attempt.test.mjs`: nueve casos de regresión del cliente.
- `tests/integration/postgres.test.mjs`: dos casos adicionales sobre PostgreSQL real.
- Cuatro suites `tests/web/reservation-{identity-read,recovery,receipt,session}.spec.mjs` y dos
  helpers de navegador/testigo SQL, conectados mediante `scripts/test-web.mjs`.
- Documentación: este informe, contrato, evidencia agregada y dos antecedentes 5A.1.

No se modifican servicios de backend, ACL, permisos, RLS ni las migraciones 001–041.
No hay migración nueva, inventario alternativo, almacenamiento persistente,
reenvíos automáticos, Android/PWA, GPS, cobros, avisos ni proveedor externo.

## 3. Pruebas y evidencias de integridad

Pruebas dirigidas añadidas:

- Unitarias: pérdida de respuesta, cuerpo inmutable, recibo con lectura fallida,
  revocación/cambio de cuenta, respuesta tardía, doble clic, HTTP/JSON insuficientes,
  pérdida de red durante comprobación de sesión y congelación previa a esa espera.
- PostgreSQL: fallo de enriquecimiento después del COMMIT real; revocación de la
  sesión original y recuperación con otra sesión del mismo actor; cuatro reenvíos
  concurrentes de un grupo dividido, preservando recibos, miembros, precio y auditoría.
- E2E: corte antes del POST, pérdida de respuesta tras COMMIT real, consulta sin
  atribución ficticia de recibo, navegación e historial bloqueados, recibo con lectura
  503, recuperación solo con cuenta original y respuesta tardía de otra cuenta.
- E2E ENROUTE: mismo cuerpo/clave y tarifa, oferta HELD separada de abordaje/salida.
- Accesibilidad Axe, ausencia de desbordamiento móvil y de persistencia en navegador.

El testigo independiente usa transacciones READ ONLY/REPEATABLE READ en la base
ficticia de cada suite. Comprueba un recibo y una reserva tras recuperar una
solicitud individual, mismas huellas lógicas antes/después del reenvío, seis plazas
máximas por segmento, precio/versión acordados, auditoría sin duplicados y ausencia
de movimientos físicos inventados. La integración compara además huellas de todas
las tablas de negocio antes/después de recuperar recibos y grupos concurrentes.

Resultados locales ya ejecutados: `npm run test:all` terminó con código 0:
**86/86 unitarias y 408/408 PostgreSQL**, TypeScript/build, detección del runner
fallido (exit 9 esperado) y cierre de ambas APIs locales. Las pruebas dirigidas
iniciales aprobaron 9 unitarias, 2 PG y 12 ejecuciones E2E (6 casos, escritorio/móvil).
La regresión A-B-A posterior falló sobre el GET original y aprobó en ambos
dispositivos tras usar el POST existente ligado a CSRF.
Los 8 E2E anteriores de reservas/cotizaciones también aprobaron en móvil.

La batería web completa se ejecuta sobre las fuentes funcionales estabilizadas;
su resultado exacto y el de CI/CodeQL se ratifican en el comentario final del PR,
con el SHA correspondiente. No confundir las ejecuciones dirigidas anteriores con
esa batería final ni anticipar aprobación de trabajos aún en curso. La batería
completa contiene 76 casos E2E por dispositivo (152 ejecuciones, 70 laboratorios).

Evidencia pública agregada sin credenciales, IDs de pasajeros ni cuerpos privados:
[EVIDENCIAS_5A2.json](EVIDENCIAS_5A2.json). Logs, capturas de estados incierto,
recuperado y lectura fallida de ambos dispositivos permanecen privados bajo
`.local/5a2-evidence/`; no se publican trazas ni credenciales ficticias del runner.

## 4. Fallos intermedios detectados y corregidos

1. La primera prueba nueva usaba un selector de alerta ambiguo: guardia de navegación
   y error de transporte son dos alertas distintas. Se acotó a la alerta correcta,
   conservando la aserción de bloqueo y la comprobación de URL/historial.
2. Después de reautenticar la cuenta original, Checkout conservaba la vista de sesión
   anterior. Se recuperaron los controles del intento retenido; cada siguiente paso
   manual sigue comprobando la sesión real antes de cualquier lectura o reenvío.
3. La primera suite agrupaba seis escenarios y alcanzó el límite real 120/minuto.
   El log de red mostró 429 al consultar sesión después de un COMMIT. El recibo
   quedó conservado y no se creó otra reserva. Se separaron en tres suites con
   laboratorio independiente, sin aumentar límites, timeouts ni retries ni introducir
   esperas artificiales. Este ajuste respeta el aislamiento del runner existente.
4. Se reforzó la validación de respuestas incompletas y la comprobación de identidad
   posterior a las lecturas; un JSON insuficiente no se presenta como consulta válida.

5. La revisión posterior a una batería inicial de 150 E2E descubrió un hueco de
   cobertura: cambiar la cookie A → B → A alrededor de un GET propio podía mostrar
   la lista de B bajo la intención de A. Una regresión nueva reprodujo HTTP 200
   donde debía impedirse esa sustitución. Se cambió únicamente la consulta del
   piloto al POST paginado existente con el CSRF original: cookie B + CSRF A produce
   403, se conserva el recibo de A y el siguiente paso manual consulta con CSRF fresco.
   No se añadió API ni se cambió el backend. La prueba controla además que no se
   rendericen referencias ajenas y que no se repita la reserva. La validación final
   corresponde al commit corregido; la batería inicial no cubría este caso.

Los fallos iniciales constan en logs locales; no se contabilizan como aprobados.
Los resultados finales corresponden al código estable, con huellas de fuentes
comprobadas antes de publicar. La base funcional conserva todas sus pruebas.

## 5. CI, CodeQL e incidente anterior

La rama de implementación se propone en un PR independiente hacia
`desarrollo/etapa-4`; la matriz existente evalúa Ubuntu/Windows, Node 22/24 y
escritorio/móvil. No se modifica su distribución ni la mitigación Chromium Windows.
Los resultados remotos del SHA publicado deben consultarse en el PR y su comentario
final de ratificación; no se declaran aprobados antes de ejecutar esos trabajos.
CodeQL del commit funcional se comprueba separadamente, sin atribuirle la ejecución
histórica de Etapa 4 ni el CI documental de 5A.1.

Incidente 5A.1: [diagnóstico publicado](https://github.com/pepoj1046-svg/proyecto-nexo/pull/7#issuecomment-6615358209).
El SHA documental 92a89e0 obtuvo 12/12 en intento 2; la causa exacta del primer fallo
sigue desconocida y faltan sus artefactos originales. Este incremento no modifica
la configuración de rutas para aparentar una corrección. Cualquier reaparición
en las validaciones finales se registra en el comentario de resultados del PR.

## 6. Límites, riesgos y revisión pendiente

- Solo RAM de esta pestaña abierta. Reload/cierre/caída pierden el intento y su
  clave; no cancelan reservas ni demuestran rollback. La advertencia no es persistencia.
- Sin una consulta independiente por clave no se puede resolver toda incertidumbre
  bajo pérdida prolongada de permisos, sesión, cotización o estado. Se conserva
  intención y revisión humana; no se crea otra clave para sortear ese bloqueo.
- La consulta de recuperación muestra la primera página propia; el listado completo
  paginado existente está en Mis reservas una vez resuelto el intento. No se presenta
  ausencia en esa página como inexistencia de una reserva.
- Dispositivo físico Android/Safari y uso productivo no se certifican mediante
  emulación Chromium. API y PostgreSQL siguen exclusivamente en loopback de laboratorio.
- Cambios de condiciones, menores, responsables, custodia, ofertas vencidas y
  revocaciones siguen sus contratos. No se reconfirma automáticamente ni se inventan
  políticas comerciales, legales, económicas o de retención.
- 5A.2 queda implementado y sometido a revisión mediante su PR; su cierre requiere
  auditoría y aprobación posteriores. No se inicia el siguiente incremento.

## 7. Prueba manual sencilla en Windows

1. Con Node 22/24 y dependencias fijadas, ejecutar `npm run dev:web` desde PowerShell.
2. Abrir únicamente la URL `http://127.0.0.1:puerto` que indique la consola.
3. Usar Probar Yacuiba, elegir viaje, Reservar con sesión y una cuenta ficticia del
   archivo de accesos local; revisar cotización y confirmar explícitamente el importe.
4. Para comprobar cortes reproducibles después del COMMIT utilizar las cuatro suites
   E2E del contrato; desactivar red manualmente no prueba en qué fase ocurrió el corte.
5. En incertidumbre, Consultar mis reservas sin reenviar mantiene la clave pendiente;
   Reintentar la misma solicitud conserva cuenta/cuerpo/clave. Con recibo recibido y
   lectura fallida, el control de consulta no vuelve a enviar la reserva.
6. Detener con Ctrl+C. Comprobar cierre de listener/base; no publicar puertos ni
   usar cuentas, datos, dinero o servicios reales.

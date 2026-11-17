# 5A.4-B1 — Auditoría complementaria de bfcache y privacidad

Referencia funcional: `3c2c036e8f279769cde1dffef98e30ac75ffa199`, PR #11.
Rama: `desarrollo/etapa-5a4-b1`. Solo laboratorio PostgreSQL y datos ficticios.

Este informe amplía la verificación anterior, que **no** había reproducido
bfcache nativo de Nexo. No autoriza B2/B3 ni habilitación productiva. El comentario
final de auditoría en [PR #11](https://github.com/pepoj1046-svg/proyecto-nexo/pull/11)
identifica el commit final y los resultados remotos de ese commit, sin atribuirle
checks de una revisión anterior.

## 1. Causas investigadas y evidencia

Se separaron tres impedimentos, sin retirar `Cache-Control: no-store`:

1. Playwright incluye `--disable-back-forward-cache` en sus argumentos normales.
   Al quitarlo, una página pública de control conservó su instancia JavaScript y
   emitió `pagehide`/`pageshow` confiables con `persisted=true`. Así se comprobó
   que el motor y la instrumentación podían reproducir restauraciones nativas.
2. Chrome excluye páginas `no-store` que reciben respuestas `fetch`/XHR también
   `no-store`. Nexo mantiene esas cabeceras en HTML, assets y APIs. Los motivos
   observados incluyen `response-cache-control-no-store` y
   `response-cache-control-no-store-with-js-network-request`.
3. Al permitir experimentalmente ese caso, CDP identificó
   `CacheControlNoStoreHTTPOnlyCookieModified`: la inicialización/actualización
   del contenedor HttpOnly también influye en la elegibilidad del documento.
   Esto explica una recarga completa; por sí mismo no demuestra un defecto de
   autenticación o de React.

Además se encontró una brecha del test previo: `goBack()` esperaba el evento
`load`. Una restauración nativa no vuelve a cargar el documento y puede agotar
ese wait. Se corrigió **solo el test** para esperar el commit de navegación y
comprobar después el estado visible. No se amplió ningún timeout o retry.

Fuentes contrastadas, además de los experimentos locales:

- [Chrome: bfcache y Cache-Control no-store](https://developer.chrome.com/docs/web-platform/bfcache-ccns).
- [Chromium: política del caché](https://github.com/chromium/chromium/blob/main/content/browser/back_forward_cache/back_forward_cache_impl.cc).
- [Chromium: tratamiento de respuestas JS no-store](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/threadable_loader.cc).
- [Chromium: cambios de cookies](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/render_frame_host_impl.cc).

Las referencias `main` describen código público mutable. La evidencia ejecutada
registra la versión real del binario, sus eventos y la configuración aplicada.
No se presupone que una descripción de una versión se aplique a todas las demás.

## 2. Perfil experimental de laboratorio

Se reprodujo Nexo nativo con **Chromium 154.0.8037.57, Linux**, escritorio y móvil
emulado. Para la matriz remota se utiliza el Chromium fijado por Playwright; su
versión realmente ejecutada aparece en los mensajes `NATIVE_BFCACHE` y artefactos.
No se presentan versiones de Firefox/WebKit no instaladas como verificadas.

Se selecciona el canal completo `chromium` de Chrome for Testing, en lugar de
asumir que el headless shell predeterminado se comporta igual. La configuración
se limita a un proceso/perfil efímero creado por
[el helper de pruebas](../../tests/web/support/native-bfcache.mjs), que exige
`NEXO_WEB_TEST_LOCAL=1` y URL `http://127.0.0.1:puerto`:

```text
BackForwardCache
CacheControlNoStoreEnterBackForwardCache:level/restore-unless-cookie-change
BackForwardCacheCCNSAllowlist:BackForwardCacheCCNSAllowedDomains/127.0.0.1
BackForwardCacheCCNSIgnoreUnchangedCookies
```

Se retira únicamente el argumento que desactiva bfcache; los argumentos restantes
se obtienen mediante CDP público y se conservan, incluido el tratamiento Windows
ya existente. No se usa `should_ignore_blocklists`, no se ignoran indiscriminadamente
las restricciones del navegador y no se instala una política global del sistema.

Antes de cargar el documento se crea un contenedor **anónimo**, sin autenticar
ni elegir una cuenta. El perfil permite recursos JS no-store del loopback y
omite como causa de expulsión reescrituras sin cambio de valor de cookie. Esto
**cambia heurísticas del navegador de laboratorio**, no la seguridad del gateway.
No es una recomendación de configuración productiva ni demuestra elegibilidad
de Nexo con los valores predeterminados de todos los navegadores.

Los tests verifican las cabeceras `no-store` reales, exigen contraseña, usan los
servicios/roles SQL existentes y no reescriben respuestas exitosas para hacerlas
cacheables. Las respuestas 503 simuladas conservan también `no-store`.

## 3. Qué acredita una restauración nativa

Cada nueva regresión requiere simultáneamente:

- La misma instancia JavaScript anterior a salir, identificada por un nonce de
  observación del test que no concede autoridad.
- `pageshow.isTrusted=true` y `pageshow.persisted=true` emitidos por el navegador.
- CDP `Page.frameNavigated.type=BackForwardCacheRestore`.
- Contenido privado ya oculto, con cero rectángulos de presentación, en el
  observador temprano de `pageshow`, antes de los handlers de la aplicación.
- Contenido aún oculto después de dos oportunidades de pintura mediante rAF,
  y puerta de contraseña visible antes de desbloquearlo.

No se llama `dispatchEvent` en estos escenarios. Los eventos sintéticos de las
pruebas anteriores siguen identificados como tales y no se usan para certificar
restauración nativa. Una recarga completa tampoco pasa estas nuevas aserciones.

En la observación temprana de `pagehide` puede verse `hidden=false`: el sensor se
registra antes del handler de la aplicación, cuando la página original sigue
mostrando legítimamente su información. El dato relevante al restaurar es
`pageshow` nativo con `hidden=true`/`rects=0`, seguido de los controles de pintura.
No se afirma una certificación universal del compositor o de miniaturas del SO.

## 4. Regresiones añadidas para cubrir la brecha

| Archivo | Verificación real |
| --- | --- |
| [document-bfcache-native](../../tests/web/document-bfcache-native.spec.mjs) | Documento privado restaurado; token anterior revocado mientras está fuera; petición antigua recibe 401; intento de cuenta B no abre información A; cuenta A reautentica; otra pestaña conserva sesión e intención APP después del COMMIT. |
| [reservation-bfcache-native](../../tests/web/reservation-bfcache-native.spec.mjs) | Dos casos: resultado APP incierto mantiene clave/cuerpo/cuenta y permite replay manual; recibo conocido con consulta fallida se conserva y recupera por lecturas, sin otro POST. |
| [command-bfcache-native](../../tests/web/command-bfcache-native.spec.mjs) | Recibo administrativo de verificación de llegada conserva su controlador; restaurar y autenticar no repite el comando; otra pestaña mantiene un intento APP incierto. |
| [late-bfcache-native](../../tests/web/late-bfcache-native.spec.mjs) | Respuesta HTTP real ya obtenida del gateway pero retenida en transporte se entrega después de restaurar, mientras se autentica B; información A permanece oculta; retorno a A exige contraseña; otra pestaña permanece autorizada. |

Los testigos SQL independientes y read-only comparan reservas, grupos, importes,
versiones, inventario por segmento, acciones, auditorías, movimientos y viaje.
Se comprueban claves/cuerpos originales, una acción por clave, capacidad no mayor
a seis y ausencia de escrituras automáticas. No se interpreta una lectura como
hecho físico ni se usa un segundo inventario.

No se añadieron tests que reproduzcan mecánicamente el código de los handlers.
Se conservaron las regresiones anteriores de sesiones, contexto/CSRF, respuestas
tardías, A→B→A y permisos. Los cuatro archivos nuevos contienen **cinco casos**;
el runner los ejecuta con PostgreSQL nuevo y los mismos límites que antes.

## 5. Resultados y alcance del dictamen

Las ejecuciones dirigidas, versiones, resúmenes y resultados finales se publican
en el comentario final del PR junto con los enlaces a CI/CodeQL del nuevo SHA.
No se afirma aquí la aprobación futura de una ejecución que todavía no termine.
Los PNG/JSON nativos quedan en `.local/5a4-b1-evidence/`, ya incluido en los
artefactos de CI; no incluyen cookies, contraseñas, CSRF o tokens SQL.

No se reprodujo hasta el momento un defecto funcional del gateway/React en los
escenarios nativos ejercitados. Las modificaciones están limitadas a regresiones,
helper de laboratorio, espera de navegación del test y documentación. La
comparación con el SHA de referencia de `apps`, `src`, migraciones, dependencias
y workflows debe permanecer vacía.

Durante la instrumentación se observaron y trataron fallos del harness: el wait
incorrecto de `load`, el requisito `--enable-automation` para inspeccionar la
línea de comandos del probe vacío y una colisión de artefactos al ejecutar dos
procesos Playwright sobre el mismo directorio. Se serializaron las ejecuciones;
no se ocultaron errores de aserciones ni se aumentaron presupuestos.

## 6. Riesgos residuales y propuesta de cierre

- La evidencia nativa es de perfiles experimentales de Chromium, no una
  certificación de Firefox, Safari/WebKit, Android físico u otros builds/políticas.
- Mantener `no-store` no es por sí solo una garantía de ausencia de bfcache futuro;
  se conservan la reautenticación y los guardias de presentación/transporte.
- Los sensores acreditan los puntos observados de DOM/pintura. No garantizan
  ausencia universal de capturas del compositor, miniaturas, XSS activo, malware
  o inspección privilegiada de la memoria de un dispositivo compartido.
- `pagehide` elimina la prueba utilizable del cliente y oculta sus controladores;
  **no revoca automáticamente el token SQL** ni revierte un COMMIT autorizado.
  Una capacidad completa robada conserva su alcance hasta revocación/caducidad.
  Las pruebas distinguen esta situación de la revocación real mediante logout.
- Si el navegador destruye/expulsa el documento, una recarga real sigue perdiendo
  el cuerpo RAM. B1 no reconstruye la reserva por referencia ni implementa tickets.
- Cambiar las versiones de Playwright/Chromium puede requerir revisar parámetros
  experimentales. Las regresiones fallan si no obtienen restauración nativa;
  no convierten una recarga en un falso resultado positivo.

Propuesta: si las regresiones dirigidas y la matriz del candidato final pasan,
recomendar el cierre técnico **de laboratorio de B1** dentro del contrato probado,
con los límites anteriores y revisión del propietario. No ampliar ese dictamen a
producción, cierre de toda la Etapa 5 o autorización de B2/B3.

## Reproducción en Windows o Ubuntu

Con las dependencias fijadas y Chromium de Playwright ya disponibles:

```text
node scripts/test-web.mjs --suite=late-bfcache-native.spec.mjs,document-bfcache-native.spec.mjs,reservation-bfcache-native.spec.mjs,command-bfcache-native.spec.mjs --project=desktop
node scripts/test-web.mjs --suite=late-bfcache-native.spec.mjs,document-bfcache-native.spec.mjs,reservation-bfcache-native.spec.mjs,command-bfcache-native.spec.mjs --project=mobile
```

Ejecutarlos **en secuencia**, porque comparten directorio de resultados. El runner
crea/cierra PostgreSQL y el gateway auténticos; no usar bases o credenciales reales.
Los parámetros experimentales solo se aplican a los procesos creados por estos
tests, sin cambiar el navegador personal ni la configuración de la aplicación.

## 7. Candidato local estabilizado

- TypeScript/compilación web: aprobados por los runners dirigidos.
- 25 unitarias dirigidas de sesiones, transporte y reserva: aprobadas, sin omitidas.
- 15 escenarios distintos de escritorio y 15 de móvil: aprobados. En móvil se
  conservan las diez regresiones anteriores ejecutadas y se verificaron de nuevo
  las cinco nativas con el helper final; no se suman duplicados como casos nuevos.
- Cinco restauraciones nativas por proyecto con Chromium 154.0.8037.57, incluyendo
  la entrega HTTP tardía, cuenta A→B→A, token revocado y ambas máquinas RAM.
- Cierre/reinicio de gateway y PostgreSQL: aprobados.
- No hay cambios funcionales respecto a `3c2c036`. Las baterías completas de ese
  SHA siguen como referencia histórica; la matriz del nuevo commit comprobará
  además las regresiones nuevas. Sus resultados exactos se publican por separado
  en el comentario final, únicamente cuando terminen.

## 8. Compatibilidad del harness observada en CI

El candidato inicial `b1d3adc` no acredita una matriz verde: Windows detectó
`CHROMIUM_DEFAULT_FEATURES_AMBIGUOUS` al intentar recalibrar dentro del test las
opciones ya calibradas por el runner. Se reutilizan ahora directamente las
`launchOptions` del proyecto, preservando sus args e ignoreDefaultArgs juntos.
Ubuntu registró un timeout de preparación antes de acreditar eventos nativos;
ese log por sí solo no demuestra un defecto de Nexo. Para el ensayo nativo se
selecciona explícitamente Chrome for Testing completo, sin asumir equivalencia
con el shell predeterminado, y se registra su versión antes de autenticar.
No se amplían tiempos ni se permite que una recarga pase como bfcache. El
comentario final distinguirá el candidato fallido de los resultados del SHA final.

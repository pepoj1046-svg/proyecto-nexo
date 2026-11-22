# Decisiones provisionales tomadas por Claude (encargo del 21-11-2026)

El propietario encargó completar 5A.5–5A.8 y las etapas 6–10 en laboratorio y delegó las
decisiones de negocio necesarias, con la condición de marcarlas como **provisionales** para
revisarlas al final. Este archivo las reúne todas. Ninguna es definitiva hasta que el
propietario la ratifique. Criterio general: elegir la opción **más prudente y reversible**,
sin datos reales, sin dinero real y sin servicios externos.

Cada fila indica la decisión, por qué se tomó así y qué cuesta cambiarla.

| ID | Incremento | Decisión provisional | Motivo | Cambiarla después |
| --- | --- | --- | --- | --- |
| P-5A5-1 | 5A.5 Mi cuenta | La cuenta es **de solo lectura**: nombre visible y roles activos con su asociación. No se edita nada desde ahí. | Nombre y roles afectan a recibos, directorio y autoridad; su gestión ya existe en administración. | Bajo: añadir campos editables con su propia función SQL y auditoría. |
| P-5A5-2 | 5A.5 Mi cuenta | **No** hay cambio de contraseña ni gestión de sesiones en «Mi cuenta». | Toca la fachada de identidad y la recuperación de acceso; merece un incremento propio de seguridad. | Medio: incremento de identidad con prueba de contraseña actual y revocación de sesiones. |
| P-5A5-3 | 5A.5 Mi cuenta | Preferencias de interfaz: texto más grande, contraste alto y reducir animaciones, **guardadas solo en el navegador**, sin servidor. | No son datos personales; funcionan sin sesión y no crean persistencia nueva. | Bajo: moverlas al servidor por cuenta si se quieren entre dispositivos. |
| P-5A6-1 | 5A.6 Ayuda | La ayuda es **contenido estático versionado dentro de la web** (`help-content.ts`), sin servidor ni base de datos. Se lee sin red una vez cargada la página. | Cumple «sin escrituras ni scripts externos» y es lo más simple de auditar. | Bajo: mover los textos a un archivo editable por la asociación. |
| P-5A6-2 | 5A.6 Ayuda | Los textos son **redactados por Claude** a partir de lo que el laboratorio hace de verdad. No mencionan teléfonos, plazos ni avisos externos. | No hay textos ni políticas aprobados por el propietario. | Bajo: sustituir los textos; las pruebas impiden prometer avisos, plazos o asistencia. |
| P-5A6-3 | 5A.6 Ayuda | La ayuda es **la misma para todos**, filtrable por rol. No depende de la sesión. | Evita lecturas privadas y funciona antes de iniciar sesión. | Bajo. |
| P-5A7-1 | 5A.7 Valoraciones | **Objetivo:** que la asociación conozca la calidad del servicio por ruta. No hay ranking público ni efectos sobre choferes. | Es el uso más útil con menos riesgo. Las sanciones exigen reglas y debido proceso. | Medio: un uso disciplinario exigiría reglas, revisión y apelación. |
| P-5A7-2 | 5A.7 Valoraciones | **Elegibilidad:** solo el pasajero titular de una reserva APP con viaje terminado (`COMPLETED`), en los últimos 30 días. La venta presencial no se valora. | El titular es identificable y el viaje ya ocurrió. | Bajo: ampliar la ventana o incluir la venta presencial con otro mecanismo. |
| P-5A7-3 | 5A.7 Valoraciones | **Unidad:** una valoración por reserva, aunque la reserva sea de un grupo. | La reserva es la unidad que el sistema ya conoce; evita votos múltiples. | Bajo. |
| P-5A7-4 | 5A.7 Valoraciones | **Escala:** de 1 a 5, con etiquetas opcionales cerradas (puntualidad, trato, limpieza, conducción segura). **Sin texto libre.** Es inmutable: no se edita ni se borra. | Sin texto libre no hace falta moderación ni se exponen datos personales. La inmutabilidad simplifica la auditoría. | Medio: el texto libre requeriría moderación y política de datos. |
| P-5A7-5 | 5A.7 Valoraciones | **Visibilidad:** solo los administradores de la asociación ven las valoraciones de las rutas que gestionan, **sin identidad del pasajero**, con resumen por ruta. El chofer y otras asociaciones no las ven. | Protege al pasajero y respeta el ámbito administrativo existente. | Bajo: mostrar al chofer sus propios promedios. |
| P-5A7-6 | 5A.7 Valoraciones | **Sin efectos operativos:** las valoraciones no tocan inventario, tarifas, fila, custodia ni sanciones. Las pruebas lo verifican. | Requisito del plan (5A.7). | — |

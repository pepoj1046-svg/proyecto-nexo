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

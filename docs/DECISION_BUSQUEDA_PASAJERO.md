# Decisión de producto: búsqueda de viajes por origen y destino

Estado: acordado durante diseño funcional.

## Experiencia del pasajero

La aplicación **NO** exige escoger entre transporte intermunicipal, interprovincial o interdepartamental. La persona indica **desde dónde sale** y **adónde quiere ir**, preferiblemente ciudad/localidad o punto admitido, con opción de ubicación actual tras otorgar permiso. Después elige fecha/hora si corresponde, cantidad de pasajeros (1 a 6 en piloto), asociación/servicio, parada o recogida permitida y medio de pago.

La búsqueda devuelve únicamente asociaciones adheridas y servicios habilitados para el recorrido solicitado, con tarifas y disponibilidad comprobada. No inventar viajes ni mostrar rutas sin operador habilitado. Si no hay servicio directo, informar que no existen resultados; conexiones entre rutas serán una función futura sujeta a reglas de enlace y reservas.

## Lógica interna

Clasificar internamente cobertura (intermunicipal, interprovincial, interdepartamental) a partir de localidades, límites administrativos y permisos de operación; este dato no se pide al pasajero. La implementación debe admitir las tres categorías desde el modelo de datos, aunque la expansión comercial recomendada sea intermunicipal → interprovincial → interdepartamental.

Una parada o comunidad intermedia puede ser origen/destino si la asociación permite el abordaje o descenso en ese tramo. Aplicar disponibilidad de plazas por segmentos y tarifa publicada antes de confirmar. Requerir permiso de geolocalización solo al usar ubicación actual, ofrecer entrada manual y no utilizar GPS personal fuera de la función autorizada.

## Criterios de aceptación

1. Usuario puede buscar Yacuiba → Villa Montes sin conocer ni escoger categoría de recorrido.
2. Un viaje entre provincias o departamentos utiliza idéntica pantalla de búsqueda.
3. Una asociación no autorizada o suspendida no aparece entre los resultados activos.
4. No ofrecer pasaje si el tramo o cupo de la asociación no está habilitado.
5. El pasajero ve precio, asociación, origen/destino y lugar de embarque antes de confirmar.

Esta decisión ajusta la experiencia del pasajero, pero no cambia la Etapa 1, no autoriza despliegues ni cambia los límites de gastos.

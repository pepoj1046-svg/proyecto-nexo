/**
 * Reglas puras del prototipo. Sin efectos secundarios, DB ni datos reales.
 * Cada segmento [originIndex, destinationIndex) consume plazas.
 */
export const CAPACITY = 6;

export function validateBooking(booking, stopCount) {
  if (!Number.isInteger(stopCount) || stopCount < 2) throw new Error('INVALID_ROUTE');
  const { seats, from, to, express = false } = booking;
  if (!Number.isInteger(seats) || seats < 1 || seats > CAPACITY) throw new Error('INVALID_SEATS');
  if (![from,to].every(Number.isInteger) || from < 0 || to >= stopCount || to <= from)
    throw new Error('INVALID_SEGMENT');
  if (express && seats !== CAPACITY) throw new Error('EXPRESS_REQUIRES_SIX_SEATS');
}

/**
 * inventory: confirmed bookings AND registered walk-ins with from/to stop indices;
 * proposed holds also count until expiration. Other states do not consume inventory.
 */
export function segmentAvailability(inventory, stopCount, capacity = CAPACITY) {
  if (!Number.isInteger(stopCount) || stopCount < 2) throw new Error('INVALID_ROUTE');
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('INVALID_CAPACITY');
  const occupancy = Array(stopCount - 1).fill(0);
  for (const b of inventory) {
    validateBooking(b, stopCount);
    if (!['CONFIRMED','ASSIGNED','BOARDED','HELD'].includes(b.status)) continue;
    if (b.status === 'HELD' && b.expiresAt != null) {
      if (!Number.isFinite(Date.parse(b.expiresAt))) throw new Error('INVALID_EXPIRATION');
      if (Date.parse(b.expiresAt) <= Date.now()) continue;
    }
    for (let segment=b.from; segment<b.to; segment++) occupancy[segment] += b.seats;
  }
  return occupancy.map(n => capacity - n);
}

export function fitsVehicle(booking, inventory, stopCount, capacity = CAPACITY) {
  validateBooking(booking, stopCount);
  if (booking.express) {
    // Un expreso monopoliza toda la vagoneta durante su trayecto y
    // exige no coexistir con ninguna reserva que se solape.
    return segmentAvailability(inventory,stopCount,capacity)
      .slice(booking.from,booking.to).every(free => free === capacity)
      && booking.seats === capacity;
  }
  return segmentAvailability(inventory, stopCount, capacity)
    .slice(booking.from,booking.to).every(free => free >= booking.seats);
}

/** Identificador de asociación, ruta y sentido debe coincidir. */
export function compatibleVehicle(vehicle, request) {
  return vehicle.associationId === request.associationId
    && vehicle.routeId === request.routeId
    && vehicle.direction === request.direction
    && vehicle.shiftActive === true
    && vehicle.queueActive === true
    && vehicle.status === 'QUEUED';
}

/** Primer vehículo compatible con espacio EN TODOS LOS TRAMOS del pedido. */
export function chooseVehicle(request, vehicles, stopCount) {
  validateBooking(request,stopCount);
  const sorted = [...vehicles].sort((a,b) => a.position-b.position || a.id.localeCompare(b.id));
  return sorted.find(v => compatibleVehicle(v,request)
    && fitsVehicle(request,v.inventory,stopCount,v.capacity ?? CAPACITY)) ?? null;
}

/** La salida de un lleno no modifica posiciones de vehículos incompletos. */
export function canDepart(vehicle, stopCount) {
  if (vehicle.status !== 'QUEUED' || !vehicle.queueActive || !vehicle.shiftActive) return false;
  const confirmed = vehicle.inventory.filter(b => ['CONFIRMED','ASSIGNED','BOARDED'].includes(b.status));
  const availability = segmentAvailability(confirmed,stopCount,CAPACITY);
  return availability.every(n => n >= 0)
    && confirmed.reduce((sum,b) => sum+b.seats,0) >= CAPACITY;
}

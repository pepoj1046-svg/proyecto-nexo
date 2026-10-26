const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateSearch(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    Object.keys(request).some(k => !['originLocalityId','destinationLocalityId','seats','express'].includes(k)))
    throw new Error('INVALID_SEARCH');
  const { originLocalityId, destinationLocalityId, seats = 1, express = false } = request;
  if (![originLocalityId,destinationLocalityId].every(id => typeof id === 'string' && uuid.test(id)) ||
    originLocalityId.toLowerCase() === destinationLocalityId.toLowerCase()) throw new Error('INVALID_LOCALITIES');
  if (!Number.isInteger(seats) || seats < 1 || seats > 6 || typeof express !== 'boolean' || (express && seats !== 6))
    throw new Error('INVALID_SEATS');
  return { originLocalityId, destinationLocalityId, seats, express };
}

export function validateLocalityQuery(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    Object.keys(request).some(k => !['query','limit'].includes(k))) throw new Error('INVALID_LOCALITY_QUERY');
  const { limit = 10 } = request;
  if (typeof request.query !== 'string' || request.query.length > 160) throw new Error('INVALID_LOCALITY_QUERY');
  const query = request.query.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...query].length < 2 || [...query].length > 80 || !/\p{L}/u.test(query) || /[%_\\]/u.test(query) ||
    !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_LOCALITY_QUERY');
  return { query, limit };
}

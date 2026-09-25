/**
 * Recursively strips characters/patterns that have no legitimate use in JSON API input
 * but are common XSS/NoSQL-injection payloads (script tags, javascript: URIs, Mongo-style
 * `$`/`.` operator keys). Knex parameterizes every query, so SQL injection is handled at
 * the query layer — this is defense-in-depth for stored-XSS and object-injection, not SQLi.
 */
export function sanitizeValue<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/javascript:/gi, '') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      result[key] = sanitizeValue(val);
    }
    return result as unknown as T;
  }
  return value;
}

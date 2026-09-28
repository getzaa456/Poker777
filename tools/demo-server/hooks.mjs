// Module hooks: redirect the backend's Redis and MySQL clients to in-memory stand-ins.
import { pathToFileURL } from 'node:url';
const here = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'ioredis') return { url: new URL('./redis-shim.mjs', here).href, shortCircuit: true };
  if (specifier === 'mysql2/promise') return { url: new URL('./fake-mysql.mjs', here).href, shortCircuit: true };
  return next(specifier, context);
}

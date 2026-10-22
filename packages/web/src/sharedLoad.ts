/** One load per key, shared by every caller. A failed load is forgotten, so the next caller tries again. */
export function sharedLoad<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load().catch((error: unknown) => { cache.delete(key); throw error; });
    cache.set(key, pending);
  }
  return pending;
}

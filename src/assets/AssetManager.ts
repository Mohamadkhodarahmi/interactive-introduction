/**
 * Progressive loading. Scene 0 is part of the main bundle; later scenes are
 * separate chunks that are fetched in the background once the experience has
 * started, with retry + graceful failure (the caller decides what to show).
 */
export class AssetManager {
  private cache = new Map<string, Promise<unknown>>();

  /** Load (once) a lazily imported module, retrying transient network failures. */
  module<T>(key: string, importer: () => Promise<T>, retries = 2): Promise<T> {
    const hit = this.cache.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const attempt = async (left: number): Promise<T> => {
      try {
        return await importer();
      } catch (err) {
        if (left <= 0) throw err;
        await new Promise((r) => setTimeout(r, 600 * (retries - left + 1)));
        return attempt(left - 1);
      }
    };
    const p = attempt(retries);
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    return p;
  }

  /** Warm a module in the background without surfacing errors. */
  prefetch<T>(key: string, importer: () => Promise<T>): void {
    this.module(key, importer).catch((e) => console.warn(`[assets] prefetch ${key} failed`, e));
  }

  /** Wait for the UI fonts (bounded, never blocks the experience for long). */
  async fonts(timeoutMs = 2500): Promise<void> {
    if (!("fonts" in document)) return;
    const loads = [
      document.fonts.load('300 20px "Vazirmatn"', "سلام"),
      document.fonts.load('400 16px "Vazirmatn"', "سلام"),
      document.fonts.load('400 12px "JetBrains Mono"', "SYSTEM"),
    ];
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

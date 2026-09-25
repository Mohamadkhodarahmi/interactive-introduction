/** Thrown when a running story sequence is aborted (e.g. replay). */
export class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

/** Abortable wait. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const id = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Wrap a promise so it rejects when the signal aborts. */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const onAbort = () => reject(new Aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

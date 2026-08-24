/**
 * A tiny localStorage-backed store shaped for `useSyncExternalStore`.
 *
 * React needs a cached, referentially stable snapshot: returning a freshly
 * parsed object on every read would loop forever. So the parsed value is kept
 * in memory and only re-parsed when something actually writes.
 *
 * Server rendering has no storage, so `getServerSnapshot` returns the initial
 * value and the first client render matches it — no hydration mismatch.
 */
export type LocalStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (updater: T | ((current: T) => T)) => void;
  /**
   * Pull the stored value into the cache without rendering anything, and
   * return it. `subscribe` does this for components; callers that need the
   * real value outside a render — reconciling against a server, say — would
   * otherwise read the initial value on a page with no subscribed component.
   * Browser only, idempotent, and never emits: it seeds the cache rather than
   * changing it.
   */
  hydrate: () => T;
  /** False until the browser value has been read at least once. */
  isHydrated: () => boolean;
};

export function createLocalStore<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => T,
): LocalStore<T> {
  let cache: T = initial;
  let hydrated = false;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : validate(JSON.parse(raw));
    } catch {
      // Corrupt JSON, or storage blocked in a private window.
      return initial;
    }
  }

  function hydrate(): T {
    if (!hydrated) {
      hydrated = true;
      const stored = read();
      if (stored !== initial) {
        cache = stored;
      }
    }
    return cache;
  }

  return {
    subscribe(listener) {
      // First subscriber pulls the stored value in; this runs during React's
      // subscribe phase, not as a setState inside an effect body.
      hydrate();
      listeners.add(listener);

      // Keep other tabs in sync.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        cache = read();
        emit();
      };
      window.addEventListener("storage", onStorage);

      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },

    getSnapshot: () => cache,
    getServerSnapshot: () => initial,
    hydrate,
    isHydrated: () => hydrated,

    set(updater) {
      const next =
        typeof updater === "function"
          ? (updater as (current: T) => T)(cache)
          : updater;
      cache = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Quota or private mode — state still works for this page view.
      }
      emit();
    },
  };
}

// Drop-in replacement for the window.storage API that Claude artifacts
// provide, backed by the browser's localStorage so the app works standalone
// once installed on a phone (no network / Claude runtime required).
// Runtime-safe: keeps an existing native/artifact window.storage if present,
// and falls back to in-memory storage if localStorage is unavailable/corrupt.
const NS = "hybridlog:";
const memoryStore = new Map();

function canUseLocalStorage() {
  try {
    const k = NS + "__test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

const hasLocalStorage = typeof window !== "undefined" && canUseLocalStorage();

function fullKey(key, shared) {
  return NS + (shared ? "shared:" : "personal:") + key;
}

function getStoreItem(k) {
  if (hasLocalStorage) return window.localStorage.getItem(k);
  return memoryStore.has(k) ? memoryStore.get(k) : null;
}
function setStoreItem(k, value) {
  if (hasLocalStorage) window.localStorage.setItem(k, value);
  else memoryStore.set(k, value);
}
function removeStoreItem(k) {
  if (hasLocalStorage) window.localStorage.removeItem(k);
  else memoryStore.delete(k);
}
function listStoreKeys(prefix) {
  const keys = [];
  if (hasLocalStorage) {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
  } else {
    for (const k of memoryStore.keys()) {
      if (k.startsWith(prefix)) keys.push(k);
    }
  }
  return keys;
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key, shared = false) {
      const k = fullKey(key, shared);
      const raw = getStoreItem(k);
      if (raw === null) throw new Error(`Key not found: ${key}`);
      return { key, value: raw, shared };
    },

    async set(key, value, shared = false) {
      const k = fullKey(key, shared);
      setStoreItem(k, value);
      return { key, value, shared };
    },

    async delete(key, shared = false) {
      const k = fullKey(key, shared);
      const existed = getStoreItem(k) !== null;
      removeStoreItem(k);
      return { key, deleted: existed, shared };
    },

    async list(prefix = "", shared = false) {
      const full = fullKey(prefix, shared);
      const keys = listStoreKeys(full).map((k) =>
        k.slice(NS.length + (shared ? "shared:".length : "personal:".length))
      );
      return { keys, prefix, shared };
    },
  };
}

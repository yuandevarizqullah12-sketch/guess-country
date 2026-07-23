// =====================================================================
// services/cache.js
// CacheManager modular — in-memory + localStorage backing, TTL, dan
// helper Stale-While-Revalidate. Tidak menyentuh DOM / Firebase.
// =====================================================================

const PERSIST_PREFIX = "guess-country:cache:";

export class CacheManager {
  constructor() {
    this.mem = new Map();
  }

  /**
   * Simpan value ke cache.
   * @param {string} key
   * @param {*} value
   * @param {number|null} ttlMs - null berarti tidak pernah kedaluwarsa (untuk sesi ini).
   * @param {boolean} persist - jika true, juga disimpan ke localStorage (bertahan setelah reload).
   */
  set(key, value, ttlMs = null, persist = false) {
    const entry = {
      value,
      expiresAt: ttlMs === null ? null : Date.now() + ttlMs,
      updatedAt: Date.now(),
    };
    this.mem.set(key, entry);
    if (persist) {
      try {
        localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry));
      } catch (_) {
        /* localStorage penuh / tidak tersedia — abaikan, memory cache tetap jalan */
      }
    }
    return entry;
  }

  /** Ambil entry cache mentah ({value, expiresAt, updatedAt}) atau null. */
  getEntry(key) {
    let entry = this.mem.get(key);
    if (!entry) {
      try {
        const raw = localStorage.getItem(PERSIST_PREFIX + key);
        if (raw) {
          entry = JSON.parse(raw);
          this.mem.set(key, entry); // promote ke memory
        }
      } catch (_) {
        /* abaikan */
      }
    }
    return entry || null;
  }

  /** Ambil hanya value-nya (tanpa cek TTL — dipakai untuk fallback stale/offline). */
  get(key) {
    const entry = this.getEntry(key);
    return entry ? entry.value : undefined;
  }

  /** True jika ada entry DAN belum kedaluwarsa (TTL). */
  isValid(key) {
    const entry = this.getEntry(key);
    if (!entry) return false;
    if (entry.expiresAt === null) return true;
    return Date.now() < entry.expiresAt;
  }

  invalidate(key) {
    this.mem.delete(key);
    try {
      localStorage.removeItem(PERSIST_PREFIX + key);
    } catch (_) {
      /* abaikan */
    }
  }

  clear() {
    this.mem.clear();
  }
}

// Singleton default yang dipakai di seluruh app.
export const cache = new CacheManager();

/**
 * Stale-While-Revalidate:
 * 1. Jika ada cache (walau sudah stale), langsung panggil onData(value, { stale:true }).
 * 2. Jika cache masih valid (belum lewat TTL) -> BERHENTI di sini, tidak fetch ke Firestore sama sekali.
 * 3. Jika cache tidak valid / tidak ada -> fetch() dijalankan, hasil disimpan ke cache,
 *    lalu onData(freshValue, { stale:false }) dipanggil.
 *
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<any>} fetcher
 * @param {(value:any, meta:{stale:boolean}) => void} onData
 * @param {boolean} persist
 */
export async function staleWhileRevalidate(key, ttlMs, fetcher, onData, persist = false) {
  const cached = cache.getEntry(key);

  if (cached) {
    onData(cached.value, { stale: true });
  }

  if (cache.isValid(key)) {
    return cached.value; // cache masih segar — TIDAK fetch ke Firestore.
  }

  const fresh = await fetcher();
  cache.set(key, fresh, ttlMs, persist);
  onData(fresh, { stale: false });
  return fresh;
}
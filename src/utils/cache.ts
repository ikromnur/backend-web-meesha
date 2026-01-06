type CacheItem<T> = {
  data: T;
  timestamp: number;
};

const cacheStore: {
  categories?: CacheItem<any>;
  types?: CacheItem<any>;
  objectives?: CacheItem<any>;
  colors?: CacheItem<any>;
} = {};

const genericStore: Record<string, CacheItem<any>> = {};

const DEFAULT_CACHE_TTL = 1000 * 60 * 60;

export const getCachedData = <T>(key: keyof typeof cacheStore): T | null => {
  const cached = cacheStore[key];
  if (!cached) return null;

  const isExpired = Date.now() - cached.timestamp > DEFAULT_CACHE_TTL;
  if (isExpired) {
    cacheStore[key] = undefined;
    return null;
  }

  return cached.data as T;
};

export const setCachedData = <T>(key: keyof typeof cacheStore, data: T) => {
  cacheStore[key] = {
    data,
    timestamp: Date.now(),
  };
};

export const getCachedAny = <T>(key: string, ttlMs = DEFAULT_CACHE_TTL): T | null => {
  const cached = genericStore[key];
  if (!cached) return null;
  const isExpired = Date.now() - cached.timestamp > ttlMs;
  if (isExpired) {
    delete genericStore[key];
    return null;
  }
  return cached.data as T;
};

export const setCachedAny = <T>(key: string, data: T) => {
  genericStore[key] = {
    data,
    timestamp: Date.now(),
  };
};

export const invalidatePrefix = (prefix: string) => {
  const keys = Object.keys(genericStore);
  for (const k of keys) {
    if (k.startsWith(prefix)) delete genericStore[k];
  }
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Redis from "ioredis";

class RedisService {
  private client: Redis | null = null;
  private connectionError: Error | null = null;
  private memoryCache: Map<string, { value: string; expiresAt?: number }> = new Map();

  constructor() {
    this.initialize();
  }

  private initialize() {
    const isProduction = process.env.NODE_ENV === "production";
    if (process.env.REDIS_URL) {
      try {
        console.log(`[Redis Cache] Attempting connection to: ${process.env.REDIS_URL}`);
        this.client = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          connectTimeout: 5000,
        });

        this.client.on("connect", () => {
          console.log("[Redis Cache] Connected successfully to Cloud Cache Cluster.");
          this.connectionError = null;
        });

        this.client.on("error", (err) => {
          console.error("[Redis Cache] Critical: Connection failed to Redis:", err.message);
          this.connectionError = err;
        });
      } catch (e: any) {
        console.error("[Redis Cache] Critical: Initialization failed:", e.message);
        this.connectionError = e;
      }
    } else {
      if (isProduction) {
        console.error("[Redis Cache] Critical Error: REDIS_URL environment variable is missing. Production requires Redis.");
        throw new Error("REDIS_URL environment variable is missing. Production requires a Redis connection.");
      }
      console.warn("[Redis Cache] Warning: REDIS_URL environment variable is missing. Falling back to local in-memory cache.");
      this.connectionError = new Error("REDIS_URL environment variable is missing.");
    }
  }

  /**
   * Sets a cache key with optional Time-To-Live (TTL) in seconds.
   */
  public async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    const stringified = JSON.stringify(value);
    const isProduction = process.env.NODE_ENV === "production";
    
    if (this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, stringified, "EX", ttlSeconds);
        } else {
          await this.client.set(key, stringified);
        }
        return true;
      } catch (err: any) {
        console.error(`[Redis Set Error] Failed to write key "${key}":`, err.message);
        if (isProduction) {
          throw new Error(`Redis cache set failed in production: ${err.message}`);
        }
      }
    } else if (isProduction) {
      throw new Error("Redis cache client is uninitialized or unavailable in production.");
    }

    // In-memory fallback
    const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : undefined;
    this.memoryCache.set(key, { value: stringified, expiresAt });
    return true;
  }

  /**
   * Retrieves a cache key.
   */
  public async get<T>(key: string): Promise<T | null> {
    const isProduction = process.env.NODE_ENV === "production";
    if (this.client) {
      try {
        const value = await this.client.get(key);
        if (value) {
          return JSON.parse(value) as T;
        }
        return null;
      } catch (err: any) {
        console.error(`[Redis Get Error] Failed to read key "${key}":`, err.message);
        if (isProduction) {
          throw new Error(`Redis cache get failed in production: ${err.message}`);
        }
      }
    } else if (isProduction) {
      throw new Error("Redis cache client is uninitialized or unavailable in production.");
    }

    // In-memory fallback
    const item = this.memoryCache.get(key);
    if (!item) return null;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    try {
      return JSON.parse(item.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Clears a key from the cache.
   */
  public async del(key: string): Promise<boolean> {
    const isProduction = process.env.NODE_ENV === "production";
    if (this.client) {
      try {
        await this.client.del(key);
        return true;
      } catch (err: any) {
        console.error(`[Redis Delete Error] Failed to remove key "${key}":`, err.message);
        if (isProduction) {
          throw new Error(`Redis cache delete failed in production: ${err.message}`);
        }
      }
    } else if (isProduction) {
      throw new Error("Redis cache client is uninitialized or unavailable in production.");
    }

    this.memoryCache.delete(key);
    return true;
  }

  /**
   * Ping Redis to verify connection health
   */
  public async ping(): Promise<string> {
    const isProduction = process.env.NODE_ENV === "production";
    if (this.client) {
      return await this.client.ping();
    }
    if (isProduction) {
      throw new Error("Redis connection is unavailable in production.");
    }
    return "PONG (In-Memory Fallback Cache)";
  }

  /**
   * Returns cache metrics.
   */
  public getCacheStats() {
    return {
      type: this.client ? "Cloud Redis" : "In-Memory Cache",
      keysCount: this.client ? "Active cluster-managed" : `${this.memoryCache.size} (local cache)`,
      status: this.client ? "CONNECTED" : "FALLBACK_ACTIVE"
    };
  }
}

export const redisService = new RedisService();

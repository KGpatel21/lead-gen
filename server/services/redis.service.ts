/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Redis client. Required in every environment.
 *
 * The old in-memory fallback is gone: production hiding behind a Map cache
 * masked outages, and dev quietly diverging from prod behavior led to bugs.
 * If Redis is down, callers must see it.
 */

import Redis from "ioredis";
import { config } from "../config";

class RedisService {
  private client: Redis;

  constructor() {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5_000,
      enableReadyCheck: true,
    });
    this.client.on("connect", () => console.log("[redis] connected"));
    this.client.on("error", (err) => console.error("[redis] error:", err.message));
  }

  public async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const encoded = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, encoded, "EX", ttlSeconds);
    } else {
      await this.client.set(key, encoded);
    }
  }

  public async get<T = unknown>(key: string): Promise<T | null> {
    const v = await this.client.get(key);
    if (v == null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  public async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  public async incr(key: string, by = 1): Promise<number> {
    return this.client.incrby(key, by);
  }

  public async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  public async ping(): Promise<string> {
    return this.client.ping();
  }

  public getClient(): Redis {
    return this.client;
  }
}

export const redisService = new RedisService();

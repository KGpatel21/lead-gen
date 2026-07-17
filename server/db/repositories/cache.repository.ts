/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TTL'd caches for external API responses (Google Places, Firecrawl).
 * Table rows never auto-delete — freshness is enforced at read time.
 */

import crypto from "crypto";
import { pool } from "../pool";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface CachedPlaces {
  query: string;
  city?: string;
  pageToken?: string;
  responseJson: any;
  fetchedAt: string;
}

export interface CachedFirecrawl {
  url: string;
  responseJson: any;
  fetchedAt: string;
}

export const placesCacheRepository = {
  hashKey(query: string, city?: string, pageToken?: string): string {
    return sha256(`${query.toLowerCase().trim()}|${(city || "").toLowerCase().trim()}|${pageToken || ""}`);
  },

  async get(query: string, city: string | undefined, pageToken: string | undefined, ttlSeconds: number): Promise<CachedPlaces | null> {
    const hash = this.hashKey(query, city, pageToken);
    const r = await pool.query(
      "SELECT * FROM google_places_cache WHERE query_hash = $1 AND fetched_at > NOW() - ($2 || ' seconds')::interval",
      [hash, String(ttlSeconds)]
    );
    if (!r.rows[0]) return null;
    return {
      query: r.rows[0].query,
      city: r.rows[0].city || undefined,
      pageToken: r.rows[0].page_token || undefined,
      responseJson: r.rows[0].response_json,
      fetchedAt: r.rows[0].fetched_at.toISOString(),
    };
  },

  async put(query: string, city: string | undefined, pageToken: string | undefined, responseJson: any): Promise<void> {
    const hash = this.hashKey(query, city, pageToken);
    const id = `pcache-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO google_places_cache (id, query_hash, query, city, page_token, response_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (query_hash) DO UPDATE SET response_json = EXCLUDED.response_json, fetched_at = NOW()`,
      [id, hash, query, city || null, pageToken || null, JSON.stringify(responseJson)]
    );
  },
};

export const firecrawlCacheRepository = {
  hashKey(url: string): string {
    return sha256(url.toLowerCase().trim());
  },

  async get(url: string, ttlSeconds: number): Promise<CachedFirecrawl | null> {
    const hash = this.hashKey(url);
    const r = await pool.query(
      "SELECT * FROM firecrawl_cache WHERE url_hash = $1 AND fetched_at > NOW() - ($2 || ' seconds')::interval",
      [hash, String(ttlSeconds)]
    );
    if (!r.rows[0]) return null;
    return {
      url: r.rows[0].url,
      responseJson: r.rows[0].response_json,
      fetchedAt: r.rows[0].fetched_at.toISOString(),
    };
  },

  async put(url: string, responseJson: any): Promise<void> {
    const hash = this.hashKey(url);
    const id = `fcache-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    await pool.query(
      `INSERT INTO firecrawl_cache (id, url_hash, url, response_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (url_hash) DO UPDATE SET response_json = EXCLUDED.response_json, fetched_at = NOW()`,
      [id, hash, url, JSON.stringify(responseJson)]
    );
  },
};

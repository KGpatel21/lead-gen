/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";

export interface Business {
  id: string;
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  googleRating?: number;
  googleReviewsCount?: number;
  businessCategory?: string;
  businessTypes?: string[];
  businessStatus?: string;
  sourceQuery?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBusinessInput {
  placeId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  googleRating?: number;
  googleReviewsCount?: number;
  businessCategory?: string;
  businessTypes?: string[];
  businessStatus?: string;
  sourceQuery?: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapBusiness(r: any): Business {
  return {
    id: r.id,
    placeId: r.place_id,
    name: r.name,
    address: r.address || undefined,
    latitude: r.latitude == null ? undefined : Number(r.latitude),
    longitude: r.longitude == null ? undefined : Number(r.longitude),
    phone: r.phone || undefined,
    website: r.website || undefined,
    googleMapsUrl: r.google_maps_url || undefined,
    googleRating: r.google_rating == null ? undefined : Number(r.google_rating),
    googleReviewsCount: r.google_reviews_count == null ? undefined : Number(r.google_reviews_count),
    businessCategory: r.business_category || undefined,
    businessTypes: r.business_types || undefined,
    businessStatus: r.business_status || undefined,
    sourceQuery: r.source_query || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export const businessRepository = {
  async findByPlaceId(placeId: string): Promise<Business | null> {
    const r = await pool.query("SELECT * FROM businesses WHERE place_id = $1", [placeId]);
    return r.rows[0] ? mapBusiness(r.rows[0]) : null;
  },

  async findById(id: string): Promise<Business | null> {
    const r = await pool.query("SELECT * FROM businesses WHERE id = $1", [id]);
    return r.rows[0] ? mapBusiness(r.rows[0]) : null;
  },

  async findManyByIds(ids: string[]): Promise<Business[]> {
    if (ids.length === 0) return [];
    const r = await pool.query("SELECT * FROM businesses WHERE id = ANY($1)", [ids]);
    return r.rows.map(mapBusiness);
  },

  async listBySourceQuery(sourceQuery: string, limit = 200): Promise<Business[]> {
    const r = await pool.query(
      "SELECT * FROM businesses WHERE source_query = $1 ORDER BY created_at DESC LIMIT $2",
      [sourceQuery, limit]
    );
    return r.rows.map(mapBusiness);
  },

  async upsert(input: UpsertBusinessInput): Promise<Business> {
    const existing = await this.findByPlaceId(input.placeId);
    if (existing) {
      const r = await pool.query(
        `UPDATE businesses SET
           name = $1, address = $2, latitude = $3, longitude = $4,
           phone = $5, website = $6, google_maps_url = $7, google_rating = $8,
           google_reviews_count = $9, business_category = $10, business_types = $11::jsonb,
           business_status = $12, source_query = COALESCE($13, source_query), updated_at = NOW()
         WHERE place_id = $14 RETURNING *`,
        [
          input.name,
          input.address || null,
          input.latitude ?? null,
          input.longitude ?? null,
          input.phone || null,
          input.website || null,
          input.googleMapsUrl || null,
          input.googleRating ?? null,
          input.googleReviewsCount ?? null,
          input.businessCategory || null,
          JSON.stringify(input.businessTypes || []),
          input.businessStatus || null,
          input.sourceQuery || null,
          input.placeId,
        ]
      );
      return mapBusiness(r.rows[0]);
    }
    const id = `biz-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO businesses
        (id, place_id, name, address, latitude, longitude, phone, website,
         google_maps_url, google_rating, google_reviews_count, business_category,
         business_types, business_status, source_query)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15) RETURNING *`,
      [
        id,
        input.placeId,
        input.name,
        input.address || null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.phone || null,
        input.website || null,
        input.googleMapsUrl || null,
        input.googleRating ?? null,
        input.googleReviewsCount ?? null,
        input.businessCategory || null,
        JSON.stringify(input.businessTypes || []),
        input.businessStatus || null,
        input.sourceQuery || null,
      ]
    );
    return mapBusiness(r.rows[0]);
  },
};

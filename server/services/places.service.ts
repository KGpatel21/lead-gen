/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Places API v1 (Text Search) integration.
 *
 * Uses the modern v1 REST endpoint (places:searchText) rather than the legacy
 * Text Search API — cheaper per call, supports rich field masks, native
 * pagination via nextPageToken.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

import { config } from "../config";
import { businessRepository, placesCacheRepository, Business } from "../db/repositories";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 h

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "places.types",
  "places.businessStatus",
  "nextPageToken",
].join(",");

export class PlacesNotConfiguredError extends Error {
  public readonly httpStatus = 503;
  constructor() {
    super("Google Places is not configured. Set GOOGLE_PLACES_API_KEY in .env.");
    this.name = "PlacesNotConfiguredError";
  }
}

export interface PlacesSearchInput {
  query: string;             // e.g. "coffee shops", "dental clinics"
  city?: string;             // e.g. "Seattle, WA"
  count?: number;            // desired result count (paginates to reach it, capped 60)
  pageToken?: string;        // continuation token from a prior call
}

export interface PlacesSearchResult {
  businesses: Business[];    // persisted (upserted) rows
  nextPageToken?: string;
  totalFetched: number;
  cachedPages: number;
  freshPages: number;
}

interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
}

class PlacesService {
  private requireKey(): string {
    if (!config.googlePlacesApiKey) throw new PlacesNotConfiguredError();
    return config.googlePlacesApiKey;
  }

  public isConfigured(): boolean {
    return !!config.googlePlacesApiKey;
  }

  /**
   * One page from the Places v1 Text Search API. Cached on (query, city, pageToken).
   */
  private async fetchOnePage(
    apiKey: string,
    query: string,
    city: string | undefined,
    pageToken: string | undefined
  ): Promise<{ places: RawPlace[]; nextPageToken?: string; fromCache: boolean }> {
    const cached = await placesCacheRepository.get(query, city, pageToken, CACHE_TTL_SECONDS);
    if (cached) {
      return {
        places: (cached.responseJson.places || []) as RawPlace[],
        nextPageToken: cached.responseJson.nextPageToken,
        fromCache: true,
      };
    }

    const textQuery = city ? `${query} in ${city}` : query;
    const body: Record<string, unknown> = { textQuery, pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;

    const resp = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (json && (json.error?.message || json.message)) || `Places HTTP ${resp.status}`;
      throw new Error(msg);
    }

    await placesCacheRepository.put(query, city, pageToken, json);

    return {
      places: (json.places || []) as RawPlace[],
      nextPageToken: json.nextPageToken,
      fromCache: false,
    };
  }

  private toUpsertInput(p: RawPlace, sourceQuery: string) {
    return {
      placeId: p.id,
      name: p.displayName?.text || p.id,
      address: p.formattedAddress,
      latitude: p.location?.latitude,
      longitude: p.location?.longitude,
      phone: p.internationalPhoneNumber || p.nationalPhoneNumber,
      website: p.websiteUri,
      googleMapsUrl: p.googleMapsUri,
      googleRating: p.rating,
      googleReviewsCount: p.userRatingCount,
      businessCategory: p.primaryType,
      businessTypes: p.types,
      businessStatus: p.businessStatus,
      sourceQuery,
    };
  }

  /**
   * Search Places for a keyword+city, upsert every business into Postgres,
   * follow nextPageToken until `count` results collected or run out.
   */
  public async searchAndPersist(input: PlacesSearchInput): Promise<PlacesSearchResult> {
    const apiKey = this.requireKey();
    const target = Math.min(Math.max(input.count ?? 20, 1), 60); // Places caps at 60 (3 pages)
    const sourceQuery = `${input.query} in ${input.city || "any"}`.toLowerCase();

    const collected: Business[] = [];
    let cachedPages = 0;
    let freshPages = 0;
    let currentToken: string | undefined = input.pageToken;
    let lastReturnedNextToken: string | undefined;
    let pagesFetched = 0;
    const MAX_PAGES = 3;

    while (collected.length < target && pagesFetched < MAX_PAGES) {
      const { places, nextPageToken, fromCache } = await this.fetchOnePage(
        apiKey,
        input.query,
        input.city,
        currentToken
      );
      pagesFetched++;
      if (fromCache) cachedPages++; else freshPages++;

      for (const p of places) {
        if (collected.length >= target) break;
        try {
          const biz = await businessRepository.upsert(this.toUpsertInput(p, sourceQuery));
          collected.push(biz);
        } catch (err) {
          console.warn("[places] upsert failed for", p.id, (err as Error).message);
        }
      }

      lastReturnedNextToken = nextPageToken;
      if (!nextPageToken || places.length === 0) break;
      currentToken = nextPageToken;
      if (!fromCache && collected.length < target) {
        // Google requires a short delay before nextPageToken becomes valid.
        await new Promise((r) => setTimeout(r, 2500));
      }
    }

    return {
      businesses: collected,
      nextPageToken: lastReturnedNextToken,
      totalFetched: collected.length,
      cachedPages,
      freshPages,
    };
  }
}

export const placesService = new PlacesService();

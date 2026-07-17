/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firecrawl v2 scrape wrapper.
 *
 * - Uses direct HTTP against Firecrawl v2 (avoids SDK version drift).
 * - Cached in Postgres by URL hash (24 h TTL).
 * - Retries transient failures with exponential backoff.
 * - Extracts structured fields via regex + simple heuristics on the returned markdown.
 * - Redis-backed rate limit: max 60 scrape calls per minute per process.
 */

import { config } from "../config";
import { firecrawlCacheRepository } from "../db/repositories";
import { redisService } from "./redis.service";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 h
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;
const RATE_LIMIT_KEY = "firecrawl:rl:per-minute";
const RATE_LIMIT_MAX = 60;

export class FirecrawlNotConfiguredError extends Error {
  public readonly httpStatus = 503;
  constructor() {
    super("Firecrawl is not configured. Set FIRECRAWL_API_KEY in .env.");
    this.name = "FirecrawlNotConfiguredError";
  }
}

export interface FirecrawlScrapeResult {
  url: string;
  fromCache: boolean;
  markdown: string;
  metadata: Record<string, any>;
  extracted: {
    description?: string;
    services?: string[];
    products?: string[];
    industry?: string;
    aboutUs?: string;
    technologies?: string[];
    companySize?: string;
    socialLinks?: Record<string, string>;
    emails?: string[];
    phones?: string[];
  };
}

class FirecrawlService {
  private requireKey(): string {
    if (!config.firecrawlApiKey) throw new FirecrawlNotConfiguredError();
    return config.firecrawlApiKey;
  }

  public isConfigured(): boolean {
    return !!config.firecrawlApiKey;
  }

  private normalizeUrl(u: string): string {
    let out = u.trim();
    if (!/^https?:\/\//i.test(out)) out = `https://${out}`;
    try {
      const url = new URL(out);
      url.hash = "";
      return url.toString();
    } catch {
      return out;
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const n = await redisService.incr(RATE_LIMIT_KEY, 1);
    if (n === 1) await redisService.expire(RATE_LIMIT_KEY, 60);
    if (n > RATE_LIMIT_MAX) {
      throw new Error(`Firecrawl rate limit exceeded (${RATE_LIMIT_MAX}/min). Retry in a moment.`);
    }
  }

  private async fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async callFirecrawlOnce(url: string, apiKey: string): Promise<{ markdown: string; metadata: any }> {
    const resp = await this.fetchWithTimeout(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
        timeout: 30_000,
      }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (body && (body.error || body.message)) || `Firecrawl HTTP ${resp.status}`;
      throw new Error(String(msg));
    }
    const data = body?.data || body;
    const markdown = String(data?.markdown || "");
    const metadata = data?.metadata || {};
    return { markdown, metadata };
  }

  private extractFieldsFromMarkdown(markdown: string, metadata: any): FirecrawlScrapeResult["extracted"] {
    const md = markdown || "";
    const capped = md.slice(0, 40_000);

    // Description: metadata description first, else first non-heading paragraph
    let description: string | undefined = metadata?.description || metadata?.ogDescription;
    if (!description) {
      const paragraphs = capped
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith("#") && !p.startsWith("!") && p.length > 60 && p.length < 500);
      if (paragraphs[0]) description = paragraphs[0];
    }

    // About Us block: extract markdown section under a matching heading
    const aboutHeading = capped.match(/^\s*#{1,4}\s*(?:about(?:\s+us)?|our\s+story|who\s+we\s+are)\b.*$/im);
    let aboutUs: string | undefined;
    if (aboutHeading) {
      const idx = capped.indexOf(aboutHeading[0]);
      if (idx >= 0) {
        const rest = capped.slice(idx + aboutHeading[0].length);
        const next = rest.match(/\n\s*#{1,4}\s+/);
        aboutUs = (next ? rest.slice(0, next.index) : rest).replace(/^\n+|\n+$/g, "").slice(0, 1500);
      }
    }

    // Emails
    const emails = Array.from(
      new Set(
        (capped.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
          .map((s) => s.toLowerCase())
          .filter((s) => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(s))
      )
    ).slice(0, 10);

    // Phones (loose international pattern)
    const phones = Array.from(
      new Set(
        (capped.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])
          .map((s) => s.replace(/\s+/g, " ").trim())
      )
    )
      .filter((s) => s.replace(/\D/g, "").length >= 8 && s.replace(/\D/g, "").length <= 15)
      .slice(0, 5);

    // Social links
    const socialLinks: Record<string, string> = {};
    for (const m of capped.matchAll(/https?:\/\/(?:www\.)?(facebook|instagram|twitter|x|linkedin|youtube|tiktok)\.com\/[a-zA-Z0-9._\-/?=&#]+/gi)) {
      const platform = m[1].toLowerCase().replace("x", "twitter");
      if (!socialLinks[platform]) socialLinks[platform] = m[0];
    }

    // Services / products / technologies via heading extraction
    const listItems = (heading: RegExp): string[] => {
      const h = capped.match(heading);
      if (!h) return [];
      const idx = capped.indexOf(h[0]);
      const rest = capped.slice(idx + h[0].length);
      const next = rest.match(/\n\s*#{1,4}\s+/);
      const block = next ? rest.slice(0, next.index) : rest;
      return Array.from(
        new Set(
          (block.match(/^\s*(?:[-*+]\s+|\d+\.\s+)(.+?)$/gm) || [])
            .map((s) => s.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim())
            .filter((s) => s.length > 2 && s.length < 200)
        )
      ).slice(0, 12);
    };

    const services = listItems(/^\s*#{1,4}\s*(?:our\s+)?services\b.*$/im);
    const products = listItems(/^\s*#{1,4}\s*(?:our\s+)?products?\b.*$/im);
    const technologies = listItems(/^\s*#{1,4}\s*(?:technologies|tech\s+stack|our\s+stack)\b.*$/im);

    // Naive industry guess from primary heading / title
    const industry = metadata?.keywords ? String(metadata.keywords).split(",")[0]?.trim() : undefined;

    return {
      description,
      services: services.length ? services : undefined,
      products: products.length ? products : undefined,
      industry,
      aboutUs,
      technologies: technologies.length ? technologies : undefined,
      socialLinks: Object.keys(socialLinks).length ? socialLinks : undefined,
      emails: emails.length ? emails : undefined,
      phones: phones.length ? phones : undefined,
    };
  }

  /**
   * Scrape a URL with retry + timeout + cache + rate-limit + heuristic extraction.
   */
  public async scrape(rawUrl: string): Promise<FirecrawlScrapeResult> {
    const apiKey = this.requireKey();
    const url = this.normalizeUrl(rawUrl);

    const cached = await firecrawlCacheRepository.get(url, CACHE_TTL_SECONDS);
    if (cached) {
      const markdown = String(cached.responseJson?.markdown || "");
      const metadata = cached.responseJson?.metadata || {};
      return {
        url,
        fromCache: true,
        markdown,
        metadata,
        extracted: this.extractFieldsFromMarkdown(markdown, metadata),
      };
    }

    await this.enforceRateLimit();

    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { markdown, metadata } = await this.callFirecrawlOnce(url, apiKey);
        await firecrawlCacheRepository.put(url, { markdown, metadata });
        return {
          url,
          fromCache: false,
          markdown,
          metadata,
          extracted: this.extractFieldsFromMarkdown(markdown, metadata),
        };
      } catch (err) {
        lastErr = err;
        console.warn(`[firecrawl] attempt ${attempt}/${MAX_RETRIES} failed for ${url}:`, (err as Error).message);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastErr;
  }
}

export const firecrawlService = new FirecrawlService();

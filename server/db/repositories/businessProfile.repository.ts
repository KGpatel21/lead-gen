/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { pool } from "../pool";

export type FirecrawlStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface BusinessProfile {
  id: string;
  businessId: string;
  rawScrapedMarkdown?: string;
  extractedDescription?: string;
  extractedServices?: string[];
  extractedProducts?: string[];
  extractedIndustry?: string;
  extractedAboutUs?: string;
  extractedTechnologies?: string[];
  extractedCompanySize?: string;
  extractedSocialLinks?: Record<string, string>;
  extractedEmails?: string[];
  extractedPhones?: string[];
  firecrawlStatus: FirecrawlStatus;
  firecrawlError?: string;
  scrapedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProfileInput {
  businessId: string;
  rawScrapedMarkdown?: string;
  extractedDescription?: string;
  extractedServices?: string[];
  extractedProducts?: string[];
  extractedIndustry?: string;
  extractedAboutUs?: string;
  extractedTechnologies?: string[];
  extractedCompanySize?: string;
  extractedSocialLinks?: Record<string, string>;
  extractedEmails?: string[];
  extractedPhones?: string[];
  firecrawlStatus: FirecrawlStatus;
  firecrawlError?: string;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v == null ? "" : String(v);

function mapProfile(r: any): BusinessProfile {
  return {
    id: r.id,
    businessId: r.business_id,
    rawScrapedMarkdown: r.raw_scraped_markdown || undefined,
    extractedDescription: r.extracted_description || undefined,
    extractedServices: r.extracted_services || undefined,
    extractedProducts: r.extracted_products || undefined,
    extractedIndustry: r.extracted_industry || undefined,
    extractedAboutUs: r.extracted_about_us || undefined,
    extractedTechnologies: r.extracted_technologies || undefined,
    extractedCompanySize: r.extracted_company_size || undefined,
    extractedSocialLinks: r.extracted_social_links || undefined,
    extractedEmails: r.extracted_emails || undefined,
    extractedPhones: r.extracted_phones || undefined,
    firecrawlStatus: r.firecrawl_status as FirecrawlStatus,
    firecrawlError: r.firecrawl_error || undefined,
    scrapedAt: r.scraped_at ? iso(r.scraped_at) : undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export const businessProfileRepository = {
  async findByBusinessId(businessId: string): Promise<BusinessProfile | null> {
    const r = await pool.query(
      "SELECT * FROM business_profiles WHERE business_id = $1",
      [businessId]
    );
    return r.rows[0] ? mapProfile(r.rows[0]) : null;
  },

  async upsert(input: UpsertProfileInput): Promise<BusinessProfile> {
    // Compute scraped_at in JS to avoid using the same parameter in both
    // a VARCHAR column context and a string-compare context, which trips
    // node-postgres's parameter type inference ("inconsistent types deduced").
    const scrapedAtNow = input.firecrawlStatus === "SUCCESS" ? new Date() : null;

    const existing = await this.findByBusinessId(input.businessId);
    if (existing) {
      const r = await pool.query(
        `UPDATE business_profiles SET
          raw_scraped_markdown  = COALESCE($1, raw_scraped_markdown),
          extracted_description = COALESCE($2, extracted_description),
          extracted_services    = COALESCE($3::jsonb, extracted_services),
          extracted_products    = COALESCE($4::jsonb, extracted_products),
          extracted_industry    = COALESCE($5, extracted_industry),
          extracted_about_us    = COALESCE($6, extracted_about_us),
          extracted_technologies = COALESCE($7::jsonb, extracted_technologies),
          extracted_company_size = COALESCE($8, extracted_company_size),
          extracted_social_links = COALESCE($9::jsonb, extracted_social_links),
          extracted_emails      = COALESCE($10::jsonb, extracted_emails),
          extracted_phones      = COALESCE($11::jsonb, extracted_phones),
          firecrawl_status      = $12,
          firecrawl_error       = $13,
          scraped_at            = COALESCE($14::timestamptz, scraped_at),
          updated_at            = NOW()
         WHERE business_id = $15 RETURNING *`,
        [
          input.rawScrapedMarkdown ?? null,
          input.extractedDescription ?? null,
          input.extractedServices ? JSON.stringify(input.extractedServices) : null,
          input.extractedProducts ? JSON.stringify(input.extractedProducts) : null,
          input.extractedIndustry ?? null,
          input.extractedAboutUs ?? null,
          input.extractedTechnologies ? JSON.stringify(input.extractedTechnologies) : null,
          input.extractedCompanySize ?? null,
          input.extractedSocialLinks ? JSON.stringify(input.extractedSocialLinks) : null,
          input.extractedEmails ? JSON.stringify(input.extractedEmails) : null,
          input.extractedPhones ? JSON.stringify(input.extractedPhones) : null,
          input.firecrawlStatus,
          input.firecrawlError ?? null,
          scrapedAtNow ? scrapedAtNow.toISOString() : null,
          input.businessId,
        ]
      );
      return mapProfile(r.rows[0]);
    }
    const id = `bp-${Date.now()}-${crypto.randomUUID().split("-")[0]}`;
    const r = await pool.query(
      `INSERT INTO business_profiles (
         id, business_id, raw_scraped_markdown, extracted_description,
         extracted_services, extracted_products, extracted_industry, extracted_about_us,
         extracted_technologies, extracted_company_size, extracted_social_links,
         extracted_emails, extracted_phones, firecrawl_status, firecrawl_error, scraped_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16::timestamptz)
       RETURNING *`,
      [
        id,
        input.businessId,
        input.rawScrapedMarkdown ?? null,
        input.extractedDescription ?? null,
        input.extractedServices ? JSON.stringify(input.extractedServices) : null,
        input.extractedProducts ? JSON.stringify(input.extractedProducts) : null,
        input.extractedIndustry ?? null,
        input.extractedAboutUs ?? null,
        input.extractedTechnologies ? JSON.stringify(input.extractedTechnologies) : null,
        input.extractedCompanySize ?? null,
        input.extractedSocialLinks ? JSON.stringify(input.extractedSocialLinks) : null,
        input.extractedEmails ? JSON.stringify(input.extractedEmails) : null,
        input.extractedPhones ? JSON.stringify(input.extractedPhones) : null,
        input.firecrawlStatus,
        input.firecrawlError ?? null,
        scrapedAtNow ? scrapedAtNow.toISOString() : null,
      ]
    );
    return mapProfile(r.rows[0]);
  },
};

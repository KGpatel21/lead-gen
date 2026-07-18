/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Timezone-aware working-calendar scheduler.
 *
 * Resolves the next legal send moment for a prospect given:
 *   - allowed weekdays (campaign.schedule_days)
 *   - business hours (campaign.schedule_time_start / schedule_time_end)
 *   - a resolved timezone (prospect → campaign → America/New_York)
 *   - a per-workspace / per-campaign holiday list
 *
 * The service ONLY computes a target moment. Per-hour and per-day caps
 * (max_per_hour / max_per_day) plus random gap are enforced at dispatch
 * time by the campaign runner.
 *
 * Timezone handling uses the runtime Intl API, which is available in
 * Node ≥ 14 without extra deps. All comparisons happen against
 * date/time strings formatted in the target zone.
 */

import crypto from "crypto";
import { Campaign } from "../../src/types";
import { CampaignProspect } from "../db/repositories/campaignProspect.repository";
import { holidayRepository } from "../db/repositories/holiday.repository";

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function partsInZone(date: Date, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; weekday: number } {
  // Use Intl to project `date` into `timeZone` and read local parts.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  let h = Number(parts.hour);
  if (h === 24) h = 0; // 24:00 → 00:00 next day, Intl quirk
  const mi = Number(parts.minute);
  const weekdayShort = parts.weekday;
  const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
  return { y, mo, d, h, mi, weekday: weekdayIdx };
}

/**
 * Convert local (Y-M-D H:M in `timeZone`) → UTC Date.
 * Uses a fixed-point search: start with the naive UTC guess, then adjust
 * by the zone offset diff. Two rounds converge for every zone.
 */
function localToUtc(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number
): Date {
  const targetLocalMs = Date.UTC(y, mo - 1, d, h, mi);
  let utcMs = targetLocalMs;
  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(utcMs), timeZone);
    const projectedLocalMs = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    const diff = targetLocalMs - projectedLocalMs;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs);
}

function parseHHMM(v: string, fallback: [number, number]): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || "").trim());
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mi = Math.min(59, Math.max(0, Number(m[2])));
  return [h, mi];
}

function normalizeDays(days: string[] | undefined): Set<string> {
  const s = new Set<string>();
  const src = Array.isArray(days) && days.length > 0
    ? days
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  for (const d of src) {
    if (!d) continue;
    const k = String(d).trim();
    // Accept 3-letter shorts too.
    if (k.length === 3) {
      const full = DAY_NAMES.find((n) => n.slice(0, 3).toLowerCase() === k.toLowerCase());
      if (full) s.add(full);
    } else {
      const found = DAY_NAMES.find((n) => n.toLowerCase() === k.toLowerCase());
      if (found) s.add(found);
    }
  }
  return s;
}

export interface NextSlotInput {
  campaign: Campaign & { maxPerHour?: number; maxPerDay?: number; minGapSeconds?: number; maxGapSeconds?: number; respectProspectTz?: boolean };
  prospect: Pick<CampaignProspect, "timezone" | "workspaceId" | "campaignId">;
  earliest?: Date; // earliest legal send moment (delay from prior step, retry backoff, etc.)
  now?: Date;
}

export const workingCalendarService = {
  resolveTimezone(campaign: NextSlotInput["campaign"], prospect: NextSlotInput["prospect"]): string {
    const respect = (campaign as any).respectProspectTz ?? true;
    if (respect && prospect.timezone) return prospect.timezone;
    return campaign.timezone || "America/New_York";
  },

  /**
   * Return the next Date (UTC) at which we may legally send the next
   * step for this prospect. Never returns a moment in the past.
   */
  async nextSendSlot(input: NextSlotInput): Promise<Date> {
    const now = input.now || new Date();
    const target = input.earliest && input.earliest > now ? input.earliest : now;
    const tz = this.resolveTimezone(input.campaign, input.prospect);
    const [startH, startM] = parseHHMM(input.campaign.scheduleTimeStart, [9, 0]);
    const [endH, endM] = parseHHMM(input.campaign.scheduleTimeEnd, [17, 0]);
    const days = normalizeDays(input.campaign.scheduleDays);

    // Walk forward at most 14 days to find a legal slot.
    for (let cursor = new Date(target.getTime()), guard = 0; guard < 14; guard++) {
      const parts = partsInZone(cursor, tz);
      const localDateStr = `${parts.y.toString().padStart(4, "0")}-${parts.mo.toString().padStart(2, "0")}-${parts.d.toString().padStart(2, "0")}`;

      const dayOk = days.has(DAY_NAMES[parts.weekday]);
      const holiday = await holidayRepository.isHoliday(
        input.prospect.workspaceId,
        input.prospect.campaignId,
        localDateStr
      );

      if (dayOk && !holiday) {
        // Compare current local time-of-day to the window.
        const nowMinutes = parts.h * 60 + parts.mi;
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        if (nowMinutes < startMinutes) {
          return localToUtc(tz, parts.y, parts.mo, parts.d, startH, startM);
        }
        if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
          // Inside window — send now (or at `target`).
          return cursor.getTime() > now.getTime() ? cursor : now;
        }
        // After window today — advance to next day at start.
      }

      // Advance to 00:00 local of the next day and retry.
      // Compute next day's date parts in local zone, then convert to UTC.
      const nextDayLocalMs = Date.UTC(parts.y, parts.mo - 1, parts.d + 1, startH, startM);
      cursor = localToUtc(tz, parts.y, parts.mo, parts.d + 1, startH, startM);
      if (cursor.getTime() < now.getTime() + 60_000) {
        // Belt & braces if the projection yields a moment in the past.
        cursor = new Date(nextDayLocalMs);
      }
    }

    // If we somehow can't find a slot in 14 days, return `target` — the runner
    // will surface the issue as an error rather than silently skipping.
    return target;
  },

  /**
   * Add a bounded random delay (jitter) between minGapSeconds and maxGapSeconds
   * to the given time. This scatters sends so nothing looks like a robot.
   */
  applyJitter(
    when: Date,
    campaign: NextSlotInput["campaign"]
  ): Date {
    const minS = Math.max(0, campaign.minGapSeconds ?? 45);
    const maxS = Math.max(minS, campaign.maxGapSeconds ?? 180);
    if (maxS <= 0) return when;
    // Deterministic-enough jitter using crypto for uniform distribution.
    const rangeMs = (maxS - minS) * 1000;
    const jitter = Math.floor(cryptoRandom() * rangeMs) + minS * 1000;
    return new Date(when.getTime() + jitter);
  },
};

// Local helper: high-entropy 0..1. Uses crypto for uniformity of jitter.
function cryptoRandom(): number {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

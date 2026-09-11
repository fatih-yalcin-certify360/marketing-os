import { z } from 'zod';
export const adPlatform = z.enum(['google', 'meta', 'linkedin']);
export type AdPlatform = z.infer<typeof adPlatform>;
export const advertisement = z.object({
  id: z.uuid(),
  platform: adPlatform,
  libraryId: z.string(),
  sourceUrl: z.url(),
  advertiser: z.string(),
  text: z.string(),
  status: z.enum(['active', 'inactive', 'unknown']),
  deliveryInfo: z.string().nullable(),
  observedAt: z.string(),
  screenshot: z.boolean(),
  matchedTerms: z.array(z.string()),
  advertiserScope: z.enum(['course_domain', 'other_or_unconfirmed']),
});
export type Advertisement = z.infer<typeof advertisement>;
export const adCoverage = z.object({
  platform: adPlatform,
  searchUrl: z.url(),
  query: z.string(),
  checkedAt: z.string(),
  status: z.enum(['checked', 'limited', 'blocked', 'unavailable', 'failed']),
  scannedCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  note: z.string(),
});
export const advertisingReport = z.object({
  ads: z.array(advertisement),
  coverage: z.array(adCoverage),
});
export type AdvertisingReport = z.infer<typeof advertisingReport>;

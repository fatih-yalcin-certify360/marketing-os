import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';
import { marketingChannel } from './channels.js';

/** Server-owned research, kept with the visual instead of trusting model citations. */
export const creativeResearchSource = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['persona', 'course', 'research', 'radar', 'advertisement', 'channel_guidance', 'reference_page']),
  title: z.string().max(250),
  sourceRef: z.string().max(2000),
  retrievedAt: isoTimestamp.nullable(),
  excerpt: z.string().max(2200),
  interpretation: z.string().max(1200),
  status: z.enum(['recorded', 'retrieved', 'editorial_guidance']),
  /** Text provenance never means that the source image or its performance was evaluated. */
  limitation: z.string().max(600),
});
export type CreativeResearchSource = z.infer<typeof creativeResearchSource>;

export const creativeResearchSnapshot = z.object({
  id: z.string().min(1).max(80),
  version: z.literal('creative-research-v1'),
  createdAt: isoTimestamp,
  inputKey: z.string().min(1).max(80),
  campaignId: uuid,
  briefVersionId: uuid,
  conceptVersionId: uuid,
  brandProfileVersionId: uuid,
  courseVersionId: uuid,
  personaVersionIds: z.array(uuid),
  campaignIdea: z.string(),
  visualAnchor: z.string(),
  sharedStyle: z.string(),
  brandRules: z.array(z.string()),
  personas: z.array(z.object({ id: uuid, name: z.string(), need: z.string(), assumptions: z.array(z.string()) })),
  channels: z.array(z.object({ channel: marketingChannel, role: z.string(), adaptation: z.string(), sourceIds: z.array(z.string()) })),
  sources: z.array(creativeResearchSource).max(40),
  gaps: z.array(z.string()),
  /** An audit of the actual supplied material, not a quality or performance score. */
  mode: z.enum(['recorded_sources', 'refreshed_pages', 'brief_only']),
});
export type CreativeResearchSnapshot = z.infer<typeof creativeResearchSnapshot>;

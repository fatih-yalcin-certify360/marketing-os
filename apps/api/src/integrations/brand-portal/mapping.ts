import { z } from 'zod';
import { brandProfileInput } from '@c360/contracts';
import { BrandPortalError, type PortalBundle } from './client.js';
const token = z.object({ value: z.string() }).passthrough();
const file = z.object({ url: z.string(), mime: z.string(), weight: z.number(), style: z.string() });
const schema = z.object({
  slug: z.string(), displayName: z.string(), version: z.string(), channel: z.literal('production'),
  tokens: z.object({ ui: z.record(z.string(), token), palette: z.record(z.string(), token) }),
  logos: z.array(z.object({ id: z.string(), name: z.string(), format: z.string(), mime: z.string(), diapositive: z.boolean(), url: z.string() })),
  fonts: z.object({ families: z.array(z.object({ family: z.string(), files: z.array(file) })) }),
  promptProfiles: z.object({ content_profile: z.object({
    styleGuide: z.string().max(40_000).nullish(), contentInstructions: z.string().max(40_000).nullish(),
    imageInstructions: z.string().max(40_000).nullish(), approvedExamples: z.union([z.string().max(40_000), z.array(z.string()).max(100)]).nullish(),
  }).nullish() }),
});
export function mapPortalBundle(bundle: PortalBundle) {
  const parsed = schema.safeParse(bundle);
  if (!parsed.success) throw new BrandPortalError('invalid_response');
  const b = parsed.data;
  const ui = (key: string): string => {
    const value = b.tokens.ui[key]?.value;
    if (!value) throw new BrandPortalError('invalid_response');
    return value;
  };
  const headingFamily = ui('font/heading');
  const bodyFamily = ui('font/body');
  const logo = b.logos.find(item => item.name === 'default-diapositive-rgb' && item.format === 'png' && item.diapositive);
  if (!logo) throw new BrandPortalError('invalid_response');
  const fonts = [...new Set([headingFamily, bodyFamily])].flatMap(family => {
    const entries = b.fonts.families.find(entry => entry.family === family)?.files;
    if (!entries) throw new BrandPortalError('invalid_response');
    return [400, 600, 700, 800].flatMap(weight => {
      const candidates = ['font/otf', 'font/ttf'].flatMap(mime => entries.filter(entry => entry.weight === weight && entry.style === 'normal' && entry.mime === mime));
      const chosen = candidates[0];
      if (weight === 400 && !chosen) throw new BrandPortalError('invalid_response');
      return chosen ? [{ ...chosen, family, candidates }] : [];
    });
  });
  const profile = b.promptProfiles.content_profile;
  const rules = {
    styleGuide: profile?.styleGuide ?? '', contentInstructions: profile?.contentInstructions ?? '',
    imageInstructions: profile?.imageInstructions ?? '',
    approvedExamples: Array.isArray(profile?.approvedExamples) ? profile.approvedExamples.join('\n\n') : profile?.approvedExamples ?? '',
  };
  const input = brandProfileInput.parse({
    brandName: b.displayName,
    colors: { primary: b.tokens.palette.primary?.value, surface: ui('color/surface/default'), accent: b.tokens.palette.accent?.value,
      onPrimary: ui('color/text/body-light'), onSurface: b.tokens.palette.ink?.value },
    typography: { headingFamily, bodyFamily, licenceNote: 'Fontbestanden geleverd door de interne Brand Portal; licentievoorwaarden blijven van toepassing.' },
    tone: { traits: [], description: '' }, rules: [], exampleContent: '', logoText: null, imageUsageNote: null,
  });
  const warnings = Object.values(rules).some(Boolean) ? [] : ['Brand Portal bevat voor dit label nog geen tekstuele content- of tone-of-voice-richtlijnen.'];
  return { input, rules, warnings, logo, fonts, release: b.version, slug: b.slug };
}

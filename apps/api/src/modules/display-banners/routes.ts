import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  BANNER_PLATFORM_RULES,
  BANNER_SIZE_ORDER,
  bannerScreenplay,
  bannerMotion,
  bannerPlatform,
  bannerSize,
} from '@c360/contracts';
import { requireLabelPermission } from '../../core/authz/policy.js';
import { currentUser } from '../../core/http/authenticate.js';
import { readFile } from 'node:fs/promises';
import { loadBrandResources } from '../../integrations/brand-portal/service.js';
import { fontFamilyNames, fontFaceStyle } from '../../integrations/brand-portal/font-names.js';
import {
  buildBannerSet,
  bannerSetZip,
  type BannerBrand,
  type BannerFontFile,
  type BannerSetResult,
} from './build.js';
import { proposeBannerScreenplay } from './propose.js';

/**
 * Display banners.
 *
 * Both routes build the same thing from the same input; they differ only in
 * what comes back. Nothing is stored, because nothing needs to be: the build is
 * deterministic, so the package a person downloads is the package they just
 * previewed, and a banner set is cheap enough to make twice.
 *
 * The colours and the letter are the brand's approved ones, taken from the
 * brand profile rather than from the request. A person choosing sizes is not
 * choosing a palette, and a request that could set its own colours would be a
 * way around brand approval.
 */

const params = z.object({ labelId: z.uuid() });

const body = z.object({
  platform: bannerPlatform.default('self_hosted'),
  sizes: z.array(bannerSize).min(1).max(BANNER_SIZE_ORDER.length),
  motion: bannerMotion.default('reveal'),
  screenplay: bannerScreenplay,
  clickUrl: z.url().nullable().default(null),
});

export const displayBannerRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, services } = app.appContext;
  const root = '/labels/:labelId/display-banners';

  /**
   * The logo as bytes, from the data URI the brand loader hands back.
   *
   * The package stores it as a file rather than inline: an ad platform counts
   * files and a base64 image is a third larger than the bytes it encodes.
   */
  function logoFile(dataUri: string | undefined): BannerBrand['logo'] {
    if (dataUri === undefined) return null;
    const match = /^data:image\/(png|jpeg|jpg|svg\+xml);base64,(.+)$/u.exec(dataUri);
    const kind = match?.[1];
    const body64 = match?.[2];
    if (kind === undefined || body64 === undefined) return null;
    const extension = kind === 'svg+xml' ? 'svg' : kind === 'jpeg' ? 'jpg' : (kind as 'png' | 'jpg');
    return { bytes: Buffer.from(body64, 'base64'), extension };
  }

  /**
   * The approved brand fonts as packageable files.
   *
   * Read from the same store the image renderer uses, and named by the family
   * the font itself declares rather than by what the profile says it is called
   * — a file whose internal name does not match is a file the browser will not
   * apply, and silently falling back to a system letter is the thing we are
   * trying to stop.
   */
  async function brandFonts(paths: readonly string[]): Promise<BannerFontFile[]> {
    const files: BannerFontFile[] = [];
    for (const [index, path] of paths.entries()) {
      const bytes = await readFile(path);
      const face = fontFaceStyle(bytes);
      const extension = bytes.subarray(0, 4).toString() === 'OTTO' ? 'otf' : 'ttf';
      const families = fontFamilyNames(bytes);
      if (families.length > 0)
        files.push({ name: `font-${String(index)}.${extension}`, bytes, families, ...face });
    }
    return files;
  }

  async function assemble(labelId: string, input: z.infer<typeof body>): Promise<BannerSetResult> {
    const brand = await services.brand.requireApproved(db, labelId);
    const resources = await loadBrandResources(db, env.STORAGE_ROOT, brand);
    return buildBannerSet(
      {
        ...input,
        colors: {
          background: brand.colors.surface,
          foreground: brand.colors.onSurface,
          accent: brand.colors.primary,
          onAccent: brand.colors.onPrimary,
        },
      },
      {
        headingFamily: brand.typography.headingFamily,
        bodyFamily: brand.typography.bodyFamily,
        fonts: await brandFonts(resources.fontFiles),
        logo: logoFile(resources.logoDataUri),
        /*
         * No background yet.
         *
         * A generated scene belongs here, and the screenplay already carries a
         * brief for one. Image generation is off in this deployment, and a
         * banner on a flat brand field is an honest result — the report says so
         * rather than the screen implying a picture failed to arrive.
         */
        background: null,
      },
    );
  }

  /**
   * A screenplay written from the campaign.
   *
   * The answer to "I opened the website step; make me a banner for this
   * campaign". It reads the approved brief, the chosen audiences and the chosen
   * direction, and proposes the sequence. It does not build anything: what
   * comes back fills the form, and a person approves it.
   */
  app.post(
    '/labels/:labelId/campaigns/:campaignId/display-banners/propose',
    async (request) => {
      const { labelId, campaignId } = z
        .object({ labelId: z.uuid(), campaignId: z.uuid() })
        .parse(request.params);
      return proposeBannerScreenplay(services, db, currentUser(request), { labelId, campaignId });
    },
  );

  /** What the rules are, so the screen can say them before anything is built. */
  app.get(root, async (request) => {
    const { labelId } = params.parse(request.params);
    requireLabelPermission(currentUser(request), labelId, 'content:read');
    return { platforms: BANNER_PLATFORM_RULES, sizes: BANNER_SIZE_ORDER };
  });

  /**
   * The set, with the documents, for the preview.
   *
   * The documents travel in the response rather than being written to storage:
   * a preview that is a different build from the download is a preview of
   * nothing, and the only way to be sure they match is for them to be the same
   * function called twice on the same input.
   */
  app.post(`${root}/preview`, async (request) => {
    const { labelId } = params.parse(request.params);
    requireLabelPermission(currentUser(request), labelId, 'content:write');
    const { report, previews } = await assemble(labelId, body.parse(request.body));
    return { report, previews };
  });

  /** The same build, as the package a person uploads or hosts. */
  app.post(`${root}/zip`, async (request, reply) => {
    const { labelId } = params.parse(request.params);
    requireLabelPermission(currentUser(request), labelId, 'content:write');
    const result = await assemble(labelId, body.parse(request.body));
    const zip = await bannerSetZip(result);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="display-banners.zip"')
      .header('content-length', String(zip.byteLength))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(zip);
  });
};

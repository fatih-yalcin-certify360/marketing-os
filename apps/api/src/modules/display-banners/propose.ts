import {
  bannerProposal,
  type BannerProposal,
  type BannerProvenance,
  type CurrentUser,
} from '@c360/contracts';
import type { AppContext } from '../../core/http/context.js';
import { requireLabelPermission } from '../../core/authz/policy.js';
import type { Db } from '../../core/db/types.js';

/**
 * A banner written from the campaign, rather than from an empty form.
 *
 * The material is the material that was already approved: the brief, the
 * audiences chosen in step 1, the direction chosen in step 4, and the course
 * card. Nothing new is invented about the training here — the prompt is told
 * that numbers, prices, exams and accreditations may only come from the course
 * card, and everything the model returns is checked against a schema that has
 * nowhere to put anything else.
 *
 * What comes back is a **proposal**. It lands in the form as filled-in fields,
 * and a person edits and approves it before a banner exists. That matters
 * beyond politeness: a banner runs unattended on other people's pages for weeks,
 * and the thing that stops a bad line getting there is somebody reading it.
 *
 * The versions the proposal rested on travel with it, so a banner can later be
 * checked against the brief it came from — and so a brief that moved on makes
 * the banner visibly stale rather than silently wrong.
 */
export async function proposeBannerScreenplay(
  services: AppContext['services'],
  db: Db,
  user: CurrentUser,
  input: { labelId: string; campaignId: string },
): Promise<{ proposal: BannerProposal; provenance: BannerProvenance; isMock: boolean }> {
  requireLabelPermission(user, input.labelId, 'content:write');

  const campaign = await services.campaigns.requireById(db, input.labelId, input.campaignId);
  const brief = await services.campaigns.requireApprovedBrief(db, input.campaignId);
  const concept = await services.concepts.requireSelectedConcept(db, input.campaignId);
  const brand = await services.brand.requireCurrent(db, input.labelId);
  const course = await services.courses.requireVersion(db, input.labelId, campaign.courseVersionId);
  const personas = await services.personas.findManyByIds(db, input.labelId, brief.personaVersionIds);

  const result = await services.generation.generate(db, {
    template: 'banner.screenplay',
    schema: bannerProposal,
    organizationId: user.organizationId,
    labelId: input.labelId,
    context: {
      language: 'nl',
      course,
      brand,
      personas,
      brief,
      concept,
    },
  });

  return {
    proposal: result.value,
    provenance: {
      briefVersionId: brief.id,
      personaVersionIds: brief.personaVersionIds,
      conceptVersionId: concept.id,
      courseVersionId: campaign.courseVersionId,
    },
    isMock: result.isMock,
  };
}

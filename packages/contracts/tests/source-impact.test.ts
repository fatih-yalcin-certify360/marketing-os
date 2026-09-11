import { describe, expect, it } from 'vitest';
import { assessExposure, campaignExposure } from '../src/index.js';

/**
 * How exposed a campaign is when a source it rests on changes (P4-3).
 *
 * The judgement is a function rather than a sentence buried in a service, so
 * that changing it is a visible decision and so it can be tested. The whole
 * value of the report is this distinction: a draft resting on a changed source
 * is a nuisance, and a campaign somebody already published is a problem
 * involving other people.
 */
describe('exposure', () => {
  it('treats a recorded publication as the most urgent case', () => {
    const assessment = assessExposure({
      hasPublications: true,
      hasPublishReadyExport: true,
      hasApprovedContent: true,
    });
    expect(assessment.exposure).toBe('published');
    expect(assessment.severity).toBe('high');
    expect(assessment.reasonNl).toMatch(/buiten dit systeem/u);
  });

  it('treats a produced publish-ready package as high, because we cannot know what happened to it', () => {
    /*
     * The honest position. This system hands over a file and has no idea
     * whether it was used — so it assumes it was, rather than reporting a
     * reassuring "exported but probably fine".
     */
    const assessment = assessExposure({
      hasPublications: false,
      hasPublishReadyExport: true,
      hasApprovedContent: true,
    });
    expect(assessment.exposure).toBe('exported');
    expect(assessment.severity).toBe('high');
  });

  it('treats approved-but-unexported content as medium', () => {
    const assessment = assessExposure({
      hasPublications: false,
      hasPublishReadyExport: false,
      hasApprovedContent: true,
    });
    expect(assessment.exposure).toBe('approved');
    expect(assessment.severity).toBe('medium');
    expect(assessment.reasonNl).toMatch(/goedkeuring opnieuw/u);
  });

  it('treats a draft as low, and says regenerating is enough', () => {
    const assessment = assessExposure({
      hasPublications: false,
      hasPublishReadyExport: false,
      hasApprovedContent: false,
    });
    expect(assessment.exposure).toBe('draft');
    expect(assessment.severity).toBe('low');
    expect(assessment.reasonNl).toMatch(/Opnieuw genereren/u);
  });

  it('never claims the content is wrong', () => {
    /*
     * A changed page may have had a typo fixed. The report says what rests on
     * the change and how far it got; it does not adjudicate the claim. So no
     * message may assert falsehood — that would send people retracting
     * material over a corrected comma.
     */
    for (const exposure of campaignExposure.options) {
      const assessment = assessExposure({
        hasPublications: exposure === 'published',
        hasPublishReadyExport: exposure === 'published' || exposure === 'exported',
        hasApprovedContent: exposure !== 'draft',
      });
      expect(assessment.reasonNl, exposure).not.toMatch(/onjuist|fout|verkeerd|niet waar/iu);
    }
  });

  it('covers every exposure value, so a new one cannot be added silently', () => {
    const produced = new Set(
      [
        { hasPublications: true, hasPublishReadyExport: false, hasApprovedContent: false },
        { hasPublications: false, hasPublishReadyExport: true, hasApprovedContent: false },
        { hasPublications: false, hasPublishReadyExport: false, hasApprovedContent: true },
        { hasPublications: false, hasPublishReadyExport: false, hasApprovedContent: false },
      ].map((input) => assessExposure(input).exposure),
    );
    expect([...produced].sort()).toEqual([...campaignExposure.options].sort());
  });
});

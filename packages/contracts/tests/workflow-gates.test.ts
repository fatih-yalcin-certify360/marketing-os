import { describe, expect, it } from 'vitest';
import {
  briefProposal,
  briefVersion,
  canEnterStage,
  canExportPublishReady,
  CHANNEL_CONFIG,
  checkAgainstChannel,
  contentPlanItem,
  defaultImageSpec,
  isPublishable,
  marketingChannel,
  missingGates,
  plannableContentPlan,
  plannableContentPlanItem,
  PRODUCIBLE_CHANNELS,
  PUBLISH_READY_GATES,
  SOCIAL_PILOT_CHANNELS,
  type ChannelFormatSpec,
  type ChannelVerification,
  type WorkflowGate,
} from '../src/index.js';

const allGates = (gates: readonly WorkflowGate[]): ReadonlySet<WorkflowGate> => new Set(gates);

describe('workflow gates', () => {
  it('blocks concept selection until the brief is approved', () => {
    const result = canEnterStage(allGates([]), 'concept_selection');
    expect(result.allowed).toBe(false);
    expect(result.missing).toContain('brief_version_approved');
  });

  it('allows concept selection once the brief is approved', () => {
    const result = canEnterStage(allGates(['brief_version_approved']), 'concept_selection');
    expect(result.allowed).toBe(true);
  });

  it('requires the content plan before production even with an approved brief', () => {
    const result = canEnterStage(
      allGates(['brief_version_approved', 'concept_version_selected']),
      'production',
    );
    expect(result.allowed).toBe(false);
    expect(result.missing).toContain('content_plan_approved');
  });

  it('refuses a publish-ready export while any gate is outstanding', () => {
    // Everything approved except the CTA links: still not publish-ready.
    const passed = allGates(
      PUBLISH_READY_GATES.filter((gate) => gate !== 'required_cta_links_present'),
    );
    const result = canExportPublishReady(passed);
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(['required_cta_links_present']);
    // The reason must be presentable to the user in Dutch.
    expect(result.missingLabelsNl[0]).toMatch(/CTA/u);
  });

  it('permits a publish-ready export only when every gate passed', () => {
    expect(canExportPublishReady(allGates(PUBLISH_READY_GATES)).allowed).toBe(true);
  });

  it('treats a changed dependency as blocking a publish-ready export', () => {
    const passed = allGates(
      PUBLISH_READY_GATES.filter((gate) => gate !== 'no_stale_dependencies'),
    );
    expect(canExportPublishReady(passed).allowed).toBe(false);
  });

  it('returns gates in the declared order so messages are stable', () => {
    expect(missingGates(allGates([]), PUBLISH_READY_GATES)).toEqual([...PUBLISH_READY_GATES]);
  });
});

describe('channel capability registry', () => {
/**
 * A minimal spec built for these tests.
 *
 * Borrowing a real channel's entry made the tests depend on whichever channel
 * happened to be first and on its own length rules — one of them started
 * failing on a media-length warning that had nothing to do with verification.
 * A purpose-built fixture keeps each test about the one rule it names.
 */
function specWith(verification: ChannelVerification): {
  readonly formats: readonly ChannelFormatSpec[];
} {
  const spec: ChannelFormatSpec = {
    channel: 'linkedin_organic',
    format: 'single_image',
    hard: {
      imageFormats: ['png'],
      maxImagePixels: null,
      maxImageBytes: null,
      altTextMaxChars: null,
      verification,
      sourceUrl: verification === 'unverified' ? null : 'https://example.org/spec',
      verifiedAt: verification === 'unverified' ? null : '2026-09-10T00:00:00.000Z',
    },
    guidance: {
      bodyMaxChars: null,
      bodyMaxCharsWithMedia: null,
      bodyTruncatesAtChars: null,
      headlineMaxChars: null,
      images: [{ widthPx: 1080, heightPx: 1350, aspectRatioLabel: '4:5', isDefault: true }],
      verification: 'unverified',
      sourceUrl: null,
      verifiedAt: null,
      length: {
        minBodyWords: null,
        minTotalWords: null,
        minSections: null,
        maxSections: null,
        minSectionWords: null,
        minHashtags: 0,
        maxHashtags: 0,
      },
    },
    noteNl: null,
  };
  return { formats: [spec] };
}

  /**
   * The mechanism, tested against a fixture rather than against the shipped
   * config.
   *
   * It used to assert that Facebook was not publishable, which was true and
   * became false the day Facebook's limits were sourced. Pinning the rule to a
   * channel's current status means the test dies of success: verifying a
   * channel breaks it, and the temptation is then to flip the assertion and
   * lose the rule. So the rule is tested on a spec that is unverified *by
   * construction*, and the real config's status is asserted separately below.
   */
  it('only treats a format as publishable when its hard constraints are verified', () => {
    expect(isPublishable(specWith('unverified'), 'linkedin_organic', 'single_image')).toBe(false);
    expect(
      isPublishable(specWith('verified_against_official_docs'), 'linkedin_organic', 'single_image'),
    ).toBe(true);
    // `stale` is not `verified`: a check that has aged out must stop permitting
    // publication rather than keep coasting on an old date.
    expect(isPublishable(specWith('stale'), 'linkedin_organic', 'single_image')).toBe(false);
  });

  it('has all three pilot channels verified as of the current config', () => {
    // The shipped state, stated once and in one place. When a channel's
    // verification changes, this is the assertion that should move — not the
    // rule above.
    for (const channel of SOCIAL_PILOT_CHANNELS) {
      expect(isPublishable(CHANNEL_CONFIG, channel, 'single_image'), channel).toBe(true);
    }
  });

  it('publishes a landing page without claiming a source it does not have', () => {
    /*
     * The design decision this test exists to protect.
     *
     * A landing page is served from the label's own site, so there is no
     * platform documentation to verify against. Three wrong answers were
     * available and each is worse than the one taken:
     *
     *  - mark it `verified_against_official_docs` with an invented source URL —
     *    a fabricated citation, which this product must never produce;
     *  - leave it `unverified` — a publish-ready export blocked for ever on a
     *    check that can never pass;
     *  - special-case the channel inside `isPublishable` — the rule stops being
     *    readable from the data.
     *
     * `not_platform_constrained` says the question does not apply, and it is
     * asserted here explicitly so nobody "tidies" it into `verified` later.
     */
    const spec = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'landing_page' && item.format === 'text_only',
    );
    expect(spec?.hard.verification).toBe('not_platform_constrained');
    expect(spec?.hard.sourceUrl).toBeNull();
    expect(spec?.hard.verifiedAt).toBeNull();
    expect(isPublishable(CHANNEL_CONFIG, 'landing_page', 'text_only')).toBe(true);

    // And it is not treated as a missing check: no warning telling the user to
    // go and find documentation that does not exist.
    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'landing_page',
      format: 'text_only',
      body: 'Een korte inleiding boven de eerste sectie.',
      hasImage: false,
    });
    expect(warnings.filter((warning) => warning.kind === 'specs_unverified')).toEqual([]);
    expect(warnings.filter((warning) => warning.blocksPublishReady)).toEqual([]);
  });

  it('still refuses a channel whose own check went stale', () => {
    // `not_platform_constrained` must not have widened the rule generally.
    expect(isPublishable(specWith('stale'), 'linkedin_organic', 'single_image')).toBe(false);
    expect(isPublishable(specWith('unverified'), 'linkedin_organic', 'single_image')).toBe(false);
  });

  it('produces an e-mail but refuses to call it publish-ready', () => {
    /*
     * Producible and publishable are different questions, and e-mail is the
     * case that separates them.
     *
     * A landing page has no platform, so `not_platform_constrained` is simply
     * true. E-mail *does* have constraints — clients clip, Outlook renders
     * through Word's engine — and none of them has been checked against a
     * primary source. Claiming `not_platform_constrained` here would assert
     * there is nothing to check, which is false. So content is generated and
     * exported as a draft, and the publish-ready gate refuses it, exactly as
     * it does for Facebook and for the same reason.
     */
    expect(PRODUCIBLE_CHANNELS).toContain('email');
    expect(isPublishable(CHANNEL_CONFIG, 'email', 'text_only')).toBe(false);

    const spec = CHANNEL_CONFIG.formats.find(
      (item) => item.channel === 'email' && item.format === 'text_only',
    );
    expect(spec?.hard.verification).toBe('unverified');
    // And the refusal has to say what is unverified, or it is not actionable.
    expect(spec?.noteNl).toMatch(/niet tegen een primaire bron gecontroleerd/u);
  });

  it('gives a landing page no image specification', () => {
    // Our render layer produces social formats. Inventing a hero size would put
    // a number in front of the user that nothing enforces.
    expect(defaultImageSpec(CHANNEL_CONFIG, 'landing_page', 'text_only')).toBeUndefined();
  });

  it('records a source URL and a check date for every verified spec', () => {
    for (const spec of CHANNEL_CONFIG.formats) {
      if (spec.hard.verification === 'verified_against_official_docs') {
        expect(spec.hard.sourceUrl).toBeTruthy();
        expect(spec.hard.verifiedAt).toBeTruthy();
      }
    }
  });

  it('refuses a format that has no spec at all', () => {
    expect(isPublishable(CHANNEL_CONFIG, 'google_search_ads', 'single_image')).toBe(false);
    expect(isPublishable(CHANNEL_CONFIG, 'instagram_organic', 'video')).toBe(false);
  });

  it('supplies a default image size for each pilot channel', () => {
    for (const channel of SOCIAL_PILOT_CHANNELS) {
      const spec = defaultImageSpec(CHANNEL_CONFIG, channel);
      expect(spec?.widthPx).toBeGreaterThan(0);
      expect(spec?.heightPx).toBeGreaterThan(0);
    }
  });

  it('blocks a publish-ready export when specs are unverified, but allows a draft', () => {
    // Again against a fixture, so the rule survives a channel being verified.
    const warnings = checkAgainstChannel({
      config: specWith('unverified'),
      channel: 'linkedin_organic',
      format: 'single_image',
      body: 'Korte tekst.',
      hasImage: true,
    });
    const blocking = warnings.filter((w) => w.blocksPublishReady);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.kind).toBe('specs_unverified');
    // Dutch and safe to render.
    expect(blocking[0]?.messageNl).toMatch(/officiële bron/u);
  });

  it('records the sourced Facebook limits, with a source and a date', () => {
    const facebook = CHANNEL_CONFIG.formats.find(
      (spec) => spec.channel === 'facebook_organic' && spec.format === 'single_image',
    );
    expect(facebook).toBeDefined();

    // From Meta's Graph API reference: "Files can not exceed 10MB."
    expect(facebook?.hard.maxImageBytes).toBe(10 * 1_048_576);
    // "File type: .jpeg, .bmp, .png, .gif, .tiff"
    expect(facebook?.hard.imageFormats).toContain('png');
    expect(facebook?.hard.imageFormats).toContain('jpeg');
    // Not stated by Meta, so recorded as absent rather than invented — which
    // is the whole point of these fields being nullable.
    expect(facebook?.hard.maxImagePixels).toBeNull();
    expect(facebook?.hard.altTextMaxChars).toBeNull();

    expect(facebook?.hard.sourceUrl).toMatch(/developers\.facebook\.com/u);
    expect(facebook?.hard.verifiedAt).toBeTruthy();
  });

  it('leaves Facebook guidance unverified, because Meta publishes none', () => {
    const facebook = CHANNEL_CONFIG.formats.find(
      (spec) => spec.channel === 'facebook_organic' && spec.format === 'single_image',
    );
    // Meta states no caption length for a Page post. Calling that
    // "verified as absent" would overstate it: what is unverified is our
    // guidance, and we have none from an official source. It does not gate
    // publishability — `isPublishable` reads `hard` only.
    expect(facebook?.guidance.verification).toBe('unverified');
    expect(facebook?.guidance.bodyMaxChars).toBeNull();
  });

  it('no longer blocks Facebook, now that its limits are sourced', () => {
    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'facebook_organic',
      format: 'single_image',
      body: 'Korte tekst.',
      hasImage: true,
    });
    expect(warnings.filter((warning) => warning.blocksPublishReady)).toEqual([]);
  });

  it('warns about length without blocking publication', () => {
    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'linkedin_organic',
      format: 'single_image',
      // Over the 2.000-character limit that applies when media is attached.
      body: 'x'.repeat(2_500),
      hasImage: true,
    });
    const tooLong = warnings.find((w) => w.kind === 'body_too_long');
    expect(tooLong).toBeDefined();
    // Guidance can be stale, so it advises rather than blocks.
    expect(tooLong?.blocksPublishReady).toBe(false);
  });

  it('applies the higher limit when no media is attached', () => {
    const withoutMedia = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'linkedin_organic',
      format: 'single_image',
      body: 'x'.repeat(2_500),
      hasImage: false,
    });
    expect(withoutMedia.find((w) => w.kind === 'body_too_long')).toBeUndefined();
  });

  it('warns that Instagram truncates a long caption in the feed', () => {
    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'instagram_organic',
      format: 'single_image',
      body: 'x'.repeat(400),
      hasImage: true,
    });
    const truncated = warnings.find((w) => w.kind === 'body_truncated');
    expect(truncated).toBeDefined();
    expect(truncated?.blocksPublishReady).toBe(false);
  });

  it('produces no warnings for content that fits', () => {
    const warnings = checkAgainstChannel({
      config: CHANNEL_CONFIG,
      channel: 'linkedin_organic',
      format: 'single_image',
      body: 'Een korte, passende tekst voor LinkedIn.',
      hasImage: true,
    });
    expect(warnings).toEqual([]);
  });
});

/**
 * The chain must not drift into channels this build cannot deliver.
 *
 * Found on the first real OpenAI run: the brief suggested an e-mail and a
 * landing page, the plan faithfully used them, and content was generated for
 * both. The system correctly refused to make them publish-ready — but a
 * generation call had already been spent, and the user was shown content for
 * channels the interface says are unavailable.
 *
 * The model was following our own instruction ("use only the channels in
 * <kanalen>"); the channels we handed it were wrong. So the constraint belongs
 * in the schema, which is also what the provider receives: the model then
 * *cannot* pick an undeliverable channel.
 */
describe('deliverable channels', () => {
  it('wires a proposal to the producible set and a stored row to the vocabulary', () => {
    /*
     * Two schemas, two enums, and the wiring is what is asserted.
     *
     * This used to compare *data*: it fed a proposal an undeliverable channel
     * and expected a refusal. That worked while something was undeliverable.
     * With Phase 3 complete every channel in the vocabulary is producible, so
     * there is no such value left to test with — and the test failed, which was
     * correct of it: the old assertion had quietly stopped describing anything.
     *
     * The property was never "some channel is refused". It is that a *proposal*
     * is bounded by what the build can produce, while a *stored row* is bounded
     * only by the vocabulary — so history stays readable when the producible
     * set changes, and the next designed-but-unbuilt channel is refused the day
     * it is added to `marketingChannel`. That holds whether or not the two lists
     * happen to coincide today.
     */
    expect(briefProposal.shape.channelSuggestions.element.options).toEqual([
      ...PRODUCIBLE_CHANNELS,
    ]);
    expect(briefVersion.shape.channelSuggestions.element.options).toEqual(
      marketingChannel.options,
    );

    const ok = briefProposal.shape.channelSuggestions.safeParse([...PRODUCIBLE_CHANNELS]);
    expect(ok.success).toBe(true);

    // Still an enum, not a free string.
    expect(briefProposal.shape.channelSuggestions.safeParse(['carrier_pigeon']).success).toBe(
      false,
    );
  });

  it('lets a plan propose only producible channels', () => {
    const ok = plannableContentPlan.safeParse({
      items: [{ stage: 'discover', channel: 'linkedin_organic', count: 2, withImage: true }],
      cadenceNl: 'Twee berichten in twee weken.',
      rationaleNl: 'Klein genoeg om te vergelijken voordat er wordt opgeschaald.',
    });
    expect(ok.success).toBe(true);

    // Bounded by the producible set, and still an enum rather than a string.
    expect(plannableContentPlanItem.shape.channel.options).toEqual([...PRODUCIBLE_CHANNELS]);
    const refused = plannableContentPlan.safeParse({
      items: [{ stage: 'discover', channel: 'carrier_pigeon', count: 1, withImage: false }],
      cadenceNl: 'Eén duif.',
      rationaleNl: 'Zou niet geproduceerd kunnen worden.',
    });
    expect(refused.success).toBe(false);

    // A stored plan is wider, so a plan made before a channel was producible
    // stays readable.
    expect(contentPlanItem.shape.channel.options).toEqual(marketingChannel.options);
  });

  it('keeps a stored brief readable when it names a retired channel', () => {
    // History must not become unreadable because the deliverable set changed.
    // `briefVersion` is deliberately wider than `briefProposal`.
    const stored = briefVersion.shape.channelSuggestions.safeParse(['email', 'landing_page']);
    expect(stored.success).toBe(true);
  });

  it('keeps every producible channel inside the full vocabulary', () => {
    // Guards against the two lists drifting apart.
    for (const channel of PRODUCIBLE_CHANNELS) {
      expect(marketingChannel.safeParse(channel).success, channel).toBe(true);
    }
  });
});

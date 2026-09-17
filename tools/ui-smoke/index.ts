import { chromium, type Page } from 'playwright';

/**
 * Drives the whole campaign chain through the *interface*, in a real browser.
 *
 * The API had been exercised end to end long before this existed, and that
 * turned out not to be the same thing: the brief step started its job and never
 * followed it, so the API was fine while the interface sat at step 1 forever.
 * No amount of API testing would have found that.
 *
 * It is a smoke run, not an assertion suite: it clicks what a person clicks,
 * screenshots each stage, and reports where it got stuck. A human then looks at
 * the screenshots. That division is deliberate — the things that go wrong in a
 * UI are mostly things a person notices instantly and a selector does not.
 *
 * ## Running it
 *
 *   npm run dev:stack                       # api, worker, web, database
 *   npx tsx tools/ui-smoke/index.ts ./var/ui-shots
 *
 * It uses the real AI provider that the stack is configured with, so a run
 * against OpenAI costs roughly what one campaign costs.
 */

const OUT = process.argv[2] ?? './var/ui-shots';
const BASE = process.env.WEB_BASE ?? 'http://localhost:5173';
/**
 * The label to work in, by the name shown in the sidebar switcher.
 *
 * One input, not two. There used to be a slug as well, for looking the label
 * up over the API, with a comment warning that the two had to match — so a
 * mismatch was a configuration error waiting to happen. The switcher's own
 * value carries the id, which is all the API calls need.
 */
const LABEL_NAME = process.env.UI_SMOKE_LABEL_NAME ?? 'Lindenhaeghe (Demo)';
const COURSE_LABEL = process.env.UI_SMOKE_COURSE ?? 'Wft Basis (Demo)';

/**
 * A step is either a button to click or one of these named interactions.
 *
 * `startsJob` is not documentation: a click that should queue work and does not
 * is a failure, and a click that queues nothing must not be waited on. Both
 * halves matter — see `settle`.
 */
type Step =
  | { kind: 'click'; name: string | RegExp; slug: string; startsJob: boolean }
  | { kind: 'choose-personas'; count: number; slug: string }
  | { kind: 'choose-first'; name: RegExp; slug: string };

const CHAIN: readonly Step[] = [
  /*
   * The eight numbered steps of the campaign screen, in the order the step
   * bar shows them. The bar numbers by position and every card takes its
   * number from the same list, so a tab label here doubles as a check that
   * the numbering still matches: "5. Kanaalplan" must be the fifth button.
   */
  { kind: 'click', name: 'Doelgroepen voorstellen', slug: 'doelgroepen', startsJob: true },
  { kind: 'choose-personas', count: 2, slug: 'doelgroepen-gekozen' },
  { kind: 'click', name: /^2\. Richting/u, slug: 'stap-richting', startsJob: false },
  { kind: 'click', name: 'Kansen voorstellen', slug: 'kansen', startsJob: true },
  // Choosing a direction moves the screen on to the briefing by itself.
  { kind: 'choose-first', name: /^Kies deze$/u, slug: 'kans-gekozen' },
  /*
   * Both labels of the same button: a supplied briefing is *structured*, an
   * idea is *written out*. The strings are the ones in `BriefDraftButton` —
   * this driver stalled for a whole run on a button it could see on screen,
   * because the name here was one nobody had ever rendered.
   */
  {
    kind: 'click',
    name: /^(Briefing uitwerken|Mijn briefing structureren en controleren)$/u,
    slug: 'briefing-opgesteld',
    startsJob: true,
  },
  { kind: 'click', name: /^Briefing v\d+ goedkeuren$/u, slug: 'briefing-goedgekeurd', startsJob: false },
  { kind: 'click', name: /^4\. Concept/u, slug: 'stap-concept', startsJob: false },
  { kind: 'click', name: 'Drie beeldrichtingen voorstellen', slug: 'concepten', startsJob: true },
  // Opportunities offer "Kies deze"; concepts offer "Kies". Anchored so one
  // cannot match the other's button further up the page.
  { kind: 'choose-first', name: /^Kies$/u, slug: 'concept-gekozen' },
  { kind: 'click', name: /^5\. Kanaalplan/u, slug: 'stap-kanaalplan', startsJob: false },
  { kind: 'click', name: 'Kanaalplan voorstellen', slug: 'kanaalplan', startsJob: true },
  // Exact: with an edited selection the button reads "Kanaalplan met mijn
  // keuze goedkeuren"; the driver approves the proposal as it stands.
  { kind: 'click', name: 'Kanaalplan goedkeuren', slug: 'kanaalplan-goedgekeurd', startsJob: false },
  { kind: 'click', name: /^6\. Content/u, slug: 'stap-content', startsJob: false },
  { kind: 'click', name: 'Content maken', slug: 'content', startsJob: true },
  { kind: 'click', name: /^7\. Export/u, slug: 'stap-export', startsJob: false },
  { kind: 'click', name: 'Concept exporteren', slug: 'export-concept', startsJob: false },
  { kind: 'click', name: 'Publicatieklaar', slug: 'export-publicatieklaar', startsJob: false },
  { kind: 'click', name: /^8\. Resultaten/u, slug: 'stap-resultaten', startsJob: false },
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(String(error));
  });

  /*
   * Records which request failed, not just that one did.
   *
   * The console gives "Failed to load resource: the server responded with a
   * status of 500" and no URL, which is unactionable: a run reported a 500 and
   * finding it meant querying the database for a row that was never written.
   * Method, path and status are enough to go straight to the handler.
   *
   * Refusals are recorded too, and are not necessarily faults — a
   * publicatieklaar export is *supposed* to be refused while the course
   * information is still unverified. The reader needs to see them to judge.
   */
  const failedRequests: string[] = [];
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failedRequests.push(
        `${String(status)} ${response.request().method()} ${new URL(response.url()).pathname}`,
      );
    }
  });

  const shot = async (name: string): Promise<void> => {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    process.stdout.write(`  shot ${name}\n`);
  };

  process.stdout.write(`opening ${BASE}\n`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('01-werkruimte');

  /*
   * Switch to the label under test before anything else.
   *
   * The run used to assume whichever label the switcher defaults to. That held
   * until a second pilot label was seeded and became the default: the course
   * dropdown then listed a different label's courses, and the run failed
   * looking for a course that was never going to be there. The label is an
   * input, so it is selected rather than assumed.
   */
  const switcher = page.locator('.os-labelchip');
  await switcher.click();
  await page.getByRole('menuitem', { name: LABEL_NAME }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);
  /*
   * Says which label it is actually working in.
   *
   * A run that silently operates on the wrong label fails several steps later
   * with a permission error, and the output gives no hint that the label was
   * the problem. This is one line and removes that whole class of confusion.
   *
   * Read off the chip rather than a form value: the switcher is a menu now,
   * because picking a label re-tints the whole interface and the menu shows
   * each label's colours before you commit to one.
   */
  const chosen = (await switcher.textContent())?.trim() ?? '';
  // The id the app is actually working with, read where the app keeps it.
  const labelId = await page.evaluate(() => localStorage.getItem('c360.activeLabelId') ?? '');
  process.stdout.write(`  label: ${chosen} (${labelId})\n`);

  await page.getByRole('link', { name: /Campagnes/u }).first().click();
  await page.waitForLoadState('networkidle');

  /*
   * The form sits behind one primary button when the label already has
   * campaigns; a label without any shows it open. Read the button's state
   * rather than assuming either, so the driver works on a fresh label and on
   * one that has been used all day.
   */
  const newCampaign = page.getByRole('button', { name: 'Nieuwe campagne' });
  if ((await newCampaign.count()) > 0 && (await newCampaign.getAttribute('aria-expanded')) === 'false') {
    await newCampaign.click();
  }
  const name = `UI-smoke ${new Date().toISOString().slice(11, 19)} (Demo)`;
  await page.getByLabel('Naam van de campagne').fill(name);
  // Stap 0: the objective. The full funnel, so every stage is exercised and
  // the plan, the content and the export all carry three stages.
  await page.getByRole('radio', { name: /Hele funnel/u }).check();
  await page.getByLabel('Opleiding', { exact: true }).selectOption({ label: COURSE_LABEL });
  await shot('02-nieuwe-campagne');

  await page.getByRole('button', { name: 'Campagne starten' }).click();
  await page.waitForTimeout(2_000);

  /*
   * Creation does not navigate; it reveals an "Open campagne" affordance.
   *
   * Reported rather than waited out. This step used to fail as a bare
   * thirty-second timeout on a locator, which says only that the link is
   * absent — while the screen itself was showing exactly why in Dutch, one
   * `innerText` away.
   */
  const open = page.getByRole('link', { name: /Open campagne/u }).first();
  try {
    await open.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    await shot('blocked-campagne-starten');
    throw new Error(
      `the campaign was not created.\n    screen: ${await visibleProblems(page)}\n    failed: ${
        failedRequests.length === 0 ? 'no request failed' : [...new Set(failedRequests)].join(' | ')
      }`,
    );
  }
  await open.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_500);
  await shot('03-campagne-open');
  process.stdout.write(`  campaign: ${page.url()}\n`);

  let reached = 0;
  for (const step of CHAIN) {
    try {
      // Sampled *before* the click, so a job that appears afterwards is
      // provably this step's. Sampling after the click loses the race.
      const before = await queueHead(page, labelId);
      await perform(page, step);
      await settle(page, labelId, step, before);
      await shot(`step-${String(reached + 1).padStart(2, '0')}-${step.slug}`);
      reached += 1;
    } catch (error: unknown) {
      /*
       * Say which requests failed *now*, not only at the end.
       *
       * A stall mid-chain is almost always the page having lost its state to
       * a failed fetch — the detail query errors, the chain remounts, the
       * persona choice and the job handle are gone — and the locator timeout
       * that results says nothing about the request that caused it. A run
       * stopped at "Kies deze" with the page back on step 1 cost a screenshot
       * and a guess to read; this line is what the guess needed.
       */
      process.stdout.write(
        `  STOPPED before "${describeStep(step)}": ${firstLine(error)}\n    screen: ${await visibleProblems(page)}\n    failed: ${
          failedRequests.length === 0 ? 'no request failed' : [...new Set(failedRequests)].join(' | ')
        }\n`,
      );
      await shot(`blocked-${step.slug}`);
      break;
    }
  }

  process.stdout.write(`\nreached ${String(reached)} of ${String(CHAIN.length)} steps\n`);

  /*
   * The part that makes this a check rather than a demonstration.
   *
   * Reaching thirteen steps only proves thirteen buttons were clickable. Every
   * defect this driver has found was visible in the *state* afterwards and not
   * in the clicking: a brief that was written but never displayed, a chain
   * whose steps ran out of order, an export that answered 500 while its button
   * returned quietly to normal. So the run ends by reading what the campaign
   * actually contains and saying, per claim, whether it holds.
   */
  const checks =
    reached === CHAIN.length
      ? await verifyOutcome(page, labelId, consoleErrors, [...new Set(failedRequests)])
      : [
          {
            name: 'the chain completes',
            ok: false,
            detail: `stopped after ${String(reached)} of ${String(CHAIN.length)} steps`,
          },
        ];

  process.stdout.write('\nchecks:\n');
  for (const check of checks) {
    process.stdout.write(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail === undefined ? '' : ` — ${check.detail}`}\n`);
  }

  const failures = checks.filter((check) => !check.ok);
  process.stdout.write(
    `\n${String(checks.length - failures.length)} of ${String(checks.length)} checks passed\n`,
  );

  await browser.close();
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string | undefined;
}

/** Persona rows showing every question answered, counted in the Doelgroep step. */
let completeQuestionnaires = 0;

/** The campaign as the interface sees it, plus the label's exports. */
interface Outcome {
  brief: { personaVersionIds: string[]; stageMessages: { stage: string; proofFields: string[] }[] } | null;
  briefApproved: boolean;
  concepts: { id: string; selected: boolean }[];
  selectedConcept: unknown;
  plan: {
    reviewState: string;
    plan: {
      items: { stage: string | null }[];
      channelAdvice: { channel: string }[];
      measurementPlan: { stage: string }[];
    };
  } | null;
  calendar: { slots: { stage: string | null; week: number }[] };
  assets: { channel: string; funnelStage: string | null; variants: unknown[] }[];
  exports: { kind: string; sizeBytes: number; blockedReasonsNl: string[] }[];
}

/**
 * Reads the finished campaign and asserts what the product promises about it.
 *
 * Read through the page so it uses the browser's own session rather than a
 * second set of credentials, and read from the API rather than the DOM: the
 * question is what was *recorded*, not what a component chose to render. A
 * screen can show a brief it never saved.
 */
async function verifyOutcome(
  page: Page,
  labelId: string,
  consoleErrors: readonly string[],
  failedRequests: readonly string[],
): Promise<Check[]> {
  // Taken from the address bar in Node, so the evaluated function needs no
  // browser globals and this file needs no DOM types.
  const campaignId = /\/campagnes\/([0-9a-f-]{36})/u.exec(page.url())?.[1];
  if (campaignId === undefined) {
    return [
      { name: 'the campaign can be read back', ok: false, detail: `no campaign id in ${page.url()}` },
    ];
  }

  /*
   * Read from the label the run selected, not by trying each one.
   *
   * An earlier version asked every accessible label for the campaign and took
   * whichever answered. It worked, and it made the run *fail its own check*:
   * each wrong label answered 404, which the browser logs as a failed resource,
   * so the driver reported errors it had caused itself. A check that trips over
   * its own probe teaches people to ignore it.
   */
  const outcome = await page.evaluate(
    async (target: { labelId: string; campaignId: string }): Promise<Outcome | null> => {
      const response = await fetch(
        `/api/v1/labels/${target.labelId}/campaigns/${target.campaignId}`,
      );
      return response.ok ? ((await response.json()) as Outcome) : null;
    },
    { labelId, campaignId },
  );

  if (outcome === null) {
    return [
      {
        name: 'the campaign can be read back',
        ok: false,
        detail: `label ${labelId} does not serve campaign ${campaignId}`,
      },
    ];
  }

  /*
   * Shape first, for the reason this whole file exists.
   *
   * Every check below reaches into `outcome`. If the response shape changed,
   * those reads would quietly be `undefined` and most checks would report
   * something plausible — a suite passing because it asserted nothing. This is
   * the guard against that, so it comes first and is not optional.
   */
  const shaped =
    Array.isArray(outcome.concepts) && Array.isArray(outcome.assets) && Array.isArray(outcome.exports);
  if (!shaped) {
    return [
      {
        name: 'the campaign response has the expected shape',
        ok: false,
        detail: 'concepts, assets or exports is not an array; every other check would be vacuous',
      },
    ];
  }

  const draft = outcome.exports.filter((record) => record.kind === 'draft');
  const publishReady = outcome.exports.filter((record) => record.kind === 'publish_ready');
  const imageAssets = outcome.assets.filter((asset) => asset.variants.length > 0);

  /*
   * A refusal is not a failed request.
   *
   * The publish-ready export is *supposed* to be refused while the demo course
   * facts are unverified and the content is unapproved, and it answers 409 to
   * say so. Anything else in the 4xx/5xx range is a fault — that distinction is
   * what turned "there is a 500 somewhere" into a named bug.
   */
  const unexpected = failedRequests.filter((line) => !line.startsWith('409 '));
  const plannedStages = new Set(
    (outcome.plan?.plan.items ?? []).map((item) => item.stage).filter((stage) => stage !== null),
  );
  const adviceCount = outcome.plan?.plan.channelAdvice.length ?? 0;
  const advisedChannels = new Set((outcome.plan?.plan.channelAdvice ?? []).map((entry) => entry.channel));
  const measuredStages = new Set((outcome.plan?.plan.measurementPlan ?? []).map((entry) => entry.stage));
  const briefedStages = new Set((outcome.brief?.stageMessages ?? []).map((entry) => entry.stage));
  const slots = outcome.calendar?.slots ?? [];
  const firstWeekOf = (stage: string): number =>
    Math.min(...slots.filter((slot) => slot.stage === stage).map((slot) => slot.week), Number.POSITIVE_INFINITY);
  const scriptErrors = consoleErrors.filter((line) => !line.includes('Failed to load resource'));
  const emailPreview = await previewFrameText(page, outcome.assets.some((asset) => asset.channel === 'email'));

  return [
    { name: 'the chain completes', ok: true, detail: `${String(CHAIN.length)} steps` },
    {
      name: 'the campaign response has the expected shape',
      ok: true,
    },
    {
      name: 'every proposed doelgroep arrived with all 36 personavragen answered',
      ok: completeQuestionnaires >= 2,
      detail: `${String(completeQuestionnaires)} rows with 36/36`,
    },
    {
      name: 'a briefing exists, is approved, and rests on chosen doelgroepen',
      ok: outcome.brief !== null && outcome.briefApproved && outcome.brief.personaVersionIds.length > 0,
      detail:
        outcome.brief === null
          ? 'no briefing'
          : `${String(outcome.brief.personaVersionIds.length)} doelgroep(en), approved=${String(outcome.briefApproved)}`,
    },
    {
      /*
       * The run chose "Hele funnel", so the plan must cover all three stages
       * and carry advice a reader can check — the whole point of the change
       * this checks. A plan with items but no advice is the old shape.
       */
      name: 'the plan covers every funnel stage and carries channel advice',
      ok: plannedStages.size === 3 && adviceCount > 0,
      detail: `stages: ${[...plannedStages].join(', ') || 'none'}; ${String(adviceCount)} advice entries`,
    },
    {
      /*
       * Slice 2: the briefing speaks per stage, and only with confirmed
       * proof. The demo course card has unconfirmed facts, so a proof field
       * naming one would mean the server stopped removing them.
       */
      name: 'the briefing carries a message for every funnel stage, with confirmed proof only',
      ok: briefedStages.size === 3,
      detail: `stages briefed: ${[...briefedStages].join(', ') || 'none'}`,
    },
    {
      /*
       * R-2: advice for every producible channel, not only the brief's four,
       * so a person ticking an unplanned cell is not choosing blind.
       */
      // Nine channels since the website split into a course-page change and a
      // blog article (2026-09-15).
      name: 'the plan advises on every producible channel and measures every stage',
      ok: advisedChannels.size === 9 && measuredStages.size === 3,
      detail: `${String(advisedChannels.size)} channels advised; measured: ${[...measuredStages].join(', ') || 'none'}`,
    },
    {
      /*
       * Slice 3: the calendar walks the journey. Ontdekken starts before
       * Overwegen, which starts before Beslissen — the order has a reason.
       */
      name: 'the calendar sequences the stages in journey order',
      ok:
        slots.length > 0 &&
        firstWeekOf('discover') < firstWeekOf('consider') &&
        firstWeekOf('consider') < firstWeekOf('decide'),
      detail: `first weeks: ontdekken ${String(firstWeekOf('discover'))}, overwegen ${String(firstWeekOf('consider'))}, beslissen ${String(firstWeekOf('decide'))}`,
    },
    {
      name: 'every piece of content knows which funnel stage it serves',
      ok: outcome.assets.length > 0 && outcome.assets.every((asset) => typeof asset.funnelStage === 'string'),
      detail: `${String(outcome.assets.filter((asset) => typeof asset.funnelStage === 'string').length)} of ${String(outcome.assets.length)} staged`,
    },
    {
      name: 'three concepts were proposed and one is chosen',
      ok: outcome.concepts.length >= 3 && outcome.selectedConcept !== null,
      detail: `${String(outcome.concepts.length)} concept(en), gekozen=${String(outcome.selectedConcept !== null)}`,
    },
    {
      name: 'the channel plan is approved',
      ok: outcome.plan?.reviewState === 'approved',
      detail: `plan=${String(outcome.plan?.reviewState)}`,
    },
    {
      name: 'content exists with two image variants',
      ok: outcome.assets.length > 0 && imageAssets.every((asset) => asset.variants.length === 2) && imageAssets.length > 0,
      detail: `${String(outcome.assets.length)} asset(s), ${String(imageAssets.length)} met beeld`,
    },
    {
      /*
       * The one that matters most, and the one nothing had.
       *
       * Every draft export answered 500 for several migrations while this
       * driver clicked the button, saw it return to normal and counted the
       * step as done. A package with no bytes is not a package.
       */
      name: 'a draft package was produced and has bytes',
      ok: draft.length > 0 && draft.every((record) => record.sizeBytes > 0),
      detail:
        draft.length === 0
          ? 'no draft export recorded'
          : `${String(draft.length)} draft export(s), ${String(draft[0]?.sizeBytes ?? 0)} bytes`,
    },
    {
      /*
       * The gate must hold, and say why.
       *
       * Demo course facts are unverified and the content is not approved, so a
       * publish-ready package must be refused. A run where this *passed* would
       * mean the gates had stopped working — which is a worse outcome than a
       * failing step.
       */
      name: 'a publicatieklaar package is refused, with reasons',
      ok: publishReady.length > 0 && publishReady.every((record) => record.blockedReasonsNl.length > 0 && record.sizeBytes === 0),
      detail:
        publishReady.length === 0
          ? 'no publish-ready attempt recorded'
          : `${String(publishReady[0]?.blockedReasonsNl.length ?? 0)} reden(en)`,
    },
    {
      /*
       * Script errors, not HTTP statuses.
       *
       * A browser logs "Failed to load resource" for every non-2xx, so this
       * check would fail on the publicatieklaar refusal the run *wants* to
       * see. Request failures have their own check below, which knows which
       * ones are expected; this one is for exceptions, React errors and
       * anything else the page itself reports.
       */
      name: 'the browser logged no script errors',
      ok: scriptErrors.length === 0,
      detail: scriptErrors.length === 0 ? undefined : scriptErrors.slice(0, 3).join(' | '),
    },
    {
      /*
       * A preview that loads but paints nothing is worse than no preview: the
       * screen shows a blank rectangle where a person expects to see what a
       * recipient sees, and every other signal — status code, no console
       * error — says it worked. So the frame's own text is read.
       */
      name: 'the e-mail preview shows the e-mail',
      ok: emailPreview.ok,
      detail: emailPreview.detail,
    },
    {
      name: 'no request failed except the expected refusal',
      ok: unexpected.length === 0,
      detail: unexpected.length === 0 ? `refusals: ${String(failedRequests.length)}` : unexpected.join(' | '),
    },
  ];
}

async function perform(page: Page, step: Step): Promise<void> {
  switch (step.kind) {
    case 'click': {
      const button = page.getByRole('button', { name: step.name, exact: false }).first();
      await button.waitFor({ state: 'visible', timeout: 25_000 });
      await button.click();
      process.stdout.write(`  clicked ${describeStep(step)}\n`);
      return;
    }
    case 'choose-personas': {
      /*
       * The persona checkboxes by their accessible name, and nothing else.
       *
       * A bare `input[type="checkbox"]` count was satisfied by the website
       * branch's deliverable checkboxes — present in the DOM inside a hidden
       * panel — before the personas had arrived, so the driver then tried to
       * tick a hidden box and timed out. The name is the interface's own
       * label for the control, which is what the label-drift test checks.
       */
      const boxes = page.getByRole('checkbox', { name: /Kies doelgroep/u });
      await boxes.first().waitFor({ state: 'visible', timeout: 25_000 });
      const total = await boxes.count();
      /*
       * Selecting nothing is a failure, not a choice.
       *
       * This used to take `min(count, available)` and report "chose 0 of 0"
       * as a success, so a run where the personas had not arrived yet sailed
       * past this step and failed two steps later, pointing at the wrong
       * thing. The step either makes its selection or says why it could not.
       */
      if (total < step.count) {
        throw new Error(
          `expected at least ${String(step.count)} doelgroep checkboxes, found ${String(total)}`,
        );
      }
      for (let index = 0; index < step.count; index += 1) {
        await boxes.nth(index).check();
      }
      /*
       * Since 2026-09-14 a proposed persona arrives with all 36 questions
       * answered — quoted or inferred, never open. The row's badge is the
       * interface's own count; fewer complete badges than personas means the
       * questionnaire came back with open cells.
       */
      completeQuestionnaires = await page.getByText(/36\/36 personavragen/u).count();
      process.stdout.write(`  chose ${String(step.count)} of ${String(total)} doelgroepen; ${String(completeQuestionnaires)} with 36/36 personavragen\n`);
      await page.waitForTimeout(1_000);
      return;
    }
    case 'choose-first': {
      const button = page.getByRole('button', { name: step.name }).first();
      await button.waitFor({ state: 'visible', timeout: 20_000 });
      await button.click();
      process.stdout.write(`  chose the first option\n`);
      await page.waitForTimeout(2_000);
      return;
    }
  }
}

/**
 * The label's queue: the newest job's id, and how many are unfinished.
 *
 * The newest id is the appearance signal, not a count of the list. The list is
 * one page of at most 25 rows ordered newest first, so once a label has run 25
 * jobs its length stops growing — a counting check reported "25 jobs before and
 * after" and called a click broken while its job was visibly finishing. The id
 * at the head of the list changes whenever work is queued, however long the
 * label has been in use.
 *
 * Read through the page so it travels with the browser's session rather than
 * needing a second set of credentials.
 */
async function queueHead(
  page: Page,
  labelId: string,
): Promise<{ newestId: string | null; pending: number }> {
  return page.evaluate(async (id: string) => {
    /*
     * One request per poll, against a label id the run already knows.
     *
     * This used to ask `/api/v1/labels` first and find the label by slug,
     * doubling every poll for a value that never changes. Over a sixteen-step
     * chain polled every two seconds that is hundreds of needless requests —
     * enough to matter, and enough to be rate limited: a limiter's answer has
     * no `items`, so the driver died on `Cannot read properties of undefined`
     * three steps in and blamed the queue.
     */
    const response = await fetch(`/api/v1/labels/${id}/jobs`);
    if (!response.ok) {
      throw new Error(`the job list answered ${String(response.status)}`);
    }
    const jobs = (await response.json()) as { items?: { id: string; status: string }[] };
    const items = jobs.items;
    if (items === undefined) {
      throw new Error('the job list answered without an items array');
    }
    return {
      newestId: items[0]?.id ?? null,
      pending: items.filter((job) => job.status === 'queued' || job.status === 'running').length,
    };
  }, labelId);
}

/**
 * Waits for whatever job the last click started.
 *
 * Polls the job list rather than reading the DOM: a button returning to its
 * idle label does not mean the worker has finished, and that false signal is
 * exactly what hid the missing brief watcher.
 *
 * The subtle part is knowing *when there is nothing to wait for*. This used to
 * return as soon as it saw an empty queue, which is true for a fraction of a
 * second after every click — the POST that creates the job row is still in
 * flight. One run hit that window, walked on to the next step before the
 * personas existed, selected none of them, and then failed at the step after
 * that. The error pointed two steps away from the cause.
 *
 * So a step that should queue work now waits for its job to *appear* before
 * waiting for it to finish, and never sees an empty queue as "done". A step
 * that queues nothing (an approval, an export) is not made to wait for a job
 * that is never coming, and a step that should have queued one and did not
 * fails here rather than somewhere downstream.
 */
async function settle(
  page: Page,
  labelId: string,
  step: Step,
  before: { newestId: string | null; pending: number },
  timeoutMs = 300_000,
): Promise<void> {
  const started = Date.now();
  const expectsJob = step.kind === 'click' && step.startsJob;
  /** How long a job may take to show up before we call the click broken. */
  const appearanceBudgetMs = 30_000;
  let appeared = !expectsJob;
  let lastNote = '';

  /*
   * A poll may fail transiently, and that is not a chain failure.
   *
   * The Docker-free database multiplexes several connections onto one PGlite,
   * and unnamed prepared statements can collide between them under load —
   * surfacing as a 500 on whichever query lost, roughly one run in several.
   * Killing the run for it means a gate nobody trusts, and a retried poll is
   * safe because a poll reads and changes nothing.
   *
   * Persistent failure still fails: the count is what separates "the database
   * hiccuped" from "the API is down", and the overall timeout is unchanged.
   */
  let consecutivePollFailures = 0;
  const MAX_POLL_FAILURES = 5;

  for (;;) {
    let head: { newestId: string | null; pending: number };
    try {
      head = await queueHead(page, labelId);
      consecutivePollFailures = 0;
    } catch (error: unknown) {
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_POLL_FAILURES) {
        throw new Error(
          `the job list failed ${String(consecutivePollFailures)} times in a row: ${firstLine(error)}`,
          { cause: error },
        );
      }
      process.stdout.write(`    (poll failed, retrying: ${firstLine(error)})\n`);
      await page.waitForTimeout(2_000);
      continue;
    }

    const { newestId, pending } = head;
    if (newestId !== before.newestId) {
      appeared = true;
    }

    const notes = await page
      .locator('.c360-notice, [role="alert"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const joined = notes.join(' | ').replace(/\s+/gu, ' ').slice(0, 130);
    if (joined !== lastNote && joined.length > 0) {
      process.stdout.write(`    ${joined}\n`);
      lastNote = joined;
    }

    if (appeared && pending === 0 && Date.now() - started > 2_500) {
      await page.waitForTimeout(1_500);
      return;
    }
    if (!appeared && Date.now() - started > appearanceBudgetMs) {
      throw new Error(
        `clicking "${describeStep(step)}" queued no work within ${String(
          Math.round(appearanceBudgetMs / 1000),
        )}s (newest job is still ${String(before.newestId)})`,
      );
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${String(Math.round(timeoutMs / 1000))}s`);
    }
    await page.waitForTimeout(2_000);
  }
}

/**
 * Reads the e-mail preview out of its frame.
 *
 * The frame is sandboxed and origin-less, which does not stop Playwright from
 * reading it — the browser owns both sides. Waited for rather than sampled: a
 * frame that has not painted yet and a frame that never will look identical at
 * one instant, and only one of them is a defect. That distinction is not
 * academic — the step screenshot caught the frame mid-load and showed a blank
 * rectangle, which looked exactly like a broken preview until this check
 * reported the text was there. **A blank frame in `step-*-content.png` is
 * expected**; this check is the one that knows better.
 */
async function previewFrameText(
  page: Page,
  expected: boolean,
): Promise<{ ok: boolean; detail: string }> {
  if (!expected) {
    return { ok: true, detail: 'no e-mail in this campaign' };
  }
  // `.first()`: a full-funnel plan holds an e-mail for Overwegen *and* for
  // Beslissen, so there are two previews; one showing text is the claim.
  const body = page.frameLocator('iframe[src*="email.html"]').first().locator('body');
  try {
    await body.waitFor({ state: 'attached', timeout: 15_000 });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const text = (await body.innerText()).trim();
      if (text.length > 0) {
        return { ok: true, detail: `${String(text.length)} characters rendered` };
      }
      await page.waitForTimeout(1_000);
    }
    return { ok: false, detail: 'the frame is there and empty' };
  } catch (error: unknown) {
    return { ok: false, detail: firstLine(error) };
  }
}

/**
 * Whatever the screen is currently complaining about, in one line.
 *
 * A locator timeout says a thing is absent; this says why. Every refusal in
 * this product carries a Dutch sentence the user is meant to act on, and a
 * driver that discards it makes its own failures harder to read than the
 * interface it is testing.
 */
async function visibleProblems(page: Page): Promise<string> {
  const text = await page
    .locator('.c360-field__error, .c360-notice, [role="alert"]')
    .allInnerTexts()
    .catch(() => [] as string[]);
  const joined = text.join(' | ').replace(/\s+/gu, ' ').trim();
  return joined.length === 0 ? '(nothing)' : joined.slice(0, 400);
}

function describeStep(step: Step): string {
  return step.kind === 'click' ? String(step.name) : step.slug;
}

function firstLine(error: unknown): string {
  return String(error).split('\n')[0]?.slice(0, 140) ?? 'unknown error';
}

void main();

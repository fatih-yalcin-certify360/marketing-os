import type { CampaignPackageReport, QuizSignal } from '@c360/contracts';

/**
 * The keuzehulp as a working quiz (2026-09-15).
 *
 * The first keuzehulp showed three questions and, at the end, listed the
 * reader's own choices with a line of guidance each. Useful, but it did not
 * *conclude*: a reader who had just told us their situation three times was
 * shown their answers back and a button. This builds the quiz the campaign
 * promises when its call to action says "bekijk de keuzehulp": every option
 * carries a signal (fit · explore · other), the signals are counted, and the
 * reader lands on one of three outcomes written for this campaign — what the
 * answers say, what to do now, and the one link to the course page, tagged
 * so the visit can be attributed.
 *
 * Deliberately not a test. There is no score, no percentage, no admission
 * verdict and no data leaves the page: no cookies, no tracking, no form. The
 * outcome texts come from the model and are reviewed like every other piece;
 * the logic below is fixed and covered by a unit test, and the same algorithm
 * is written into the page's script so the browser decides exactly as the
 * test does.
 */

const escape = (value: string): string =>
  value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * Majority of signals wins; a tie, or no clear majority, is `explore` —
 * the honest outcome when the answers point in more than one direction.
 */
export function decideOutcome(signals: readonly QuizSignal[]): QuizSignal {
  const counts: Record<QuizSignal, number> = { fit: 0, explore: 0, other: 0 };
  for (const signal of signals) counts[signal] += 1;
  const ranked = (['fit', 'other', 'explore'] as const).map((signal) => ({ signal, count: counts[signal] })).sort((a, b) => b.count - a.count);
  const [first, second] = ranked;
  if (first === undefined || second === undefined || first.count === second.count) return 'explore';
  return first.signal;
}

/** The UTM-tagged destination, so a visit from the quiz is attributable without any tracking on the page itself. */
export function quizDestination(courseUrl: string, campaignId: string): string {
  try {
    const url = new URL(courseUrl);
    url.searchParams.set('utm_source', 'keuzehulp');
    url.searchParams.set('utm_medium', 'website');
    url.searchParams.set('utm_campaign', campaignId.slice(0, 8));
    return url.toString();
  } catch {
    return courseUrl;
  }
}

export const QUIZ_CSS = `*{box-sizing:border-box}body{margin:0;padding:24px;background:#f3f6f8;color:#132d3c;font:17px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto;background:white;padding:32px;border-radius:20px}h1{font-size:clamp(26px,5vw,38px);line-height:1.2;margin-top:0}h2{line-height:1.3;margin-bottom:.4rem}p{margin:.5rem 0 1rem}.hint{font-size:14px;color:#506570}.progress{display:flex;gap:6px;margin:0 0 18px;padding:0;list-style:none}.progress li{flex:1;height:6px;border-radius:3px;background:#dbe4ea}.progress li.done{background:#173f51}.choice,.cta,.again{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;border:1px solid #acc1cb;border-radius:12px;padding:14px 18px;margin:10px 0;background:white;color:#132d3c;text-decoration:none}.choice:hover,.choice:focus-visible{background:#eef4f7;border-color:#173f51}.cta{background:#173f51;color:white;border-color:#173f51;text-align:center;font-weight:600}.cta:hover,.cta:focus-visible{background:#0f2c3a}.again{border-style:dashed;text-align:center}.feedback{border-left:3px solid #acc1cb;padding:8px 16px;margin:12px 0;background:#f7fafb;border-radius:0 10px 10px 0}.steps{padding-left:1.2rem}.steps li{margin:.3rem 0}.brand-logo{max-height:48px;margin-bottom:16px}button:focus-visible,a:focus-visible{outline:3px solid #dc9700;outline-offset:3px}@media(prefers-reduced-motion:no-preference){.screen{animation:appear .3s ease-out}@keyframes appear{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}`;

export interface QuizFiles {
  'keuzehulp/index.html': string;
  'keuzehulp/style.css': string;
  'keuzehulp/widget.js': string;
  'keuzehulp/src/widget.ts': string;
  'keuzehulp/embed.html': string;
}

/**
 * The quiz as five files, the same layout the package always had: a page,
 * its stylesheet, the script (also as its TypeScript-compatible source) and
 * an embed snippet for the course page.
 */
export function buildQuizFiles(input: {
  content: NonNullable<CampaignPackageReport['content']>;
  courseName: string;
  courseUrl: string;
  ctaLabel: string;
  campaignId: string;
  isMock: boolean;
}): QuizFiles {
  const { content } = input;
  const destination = quizDestination(input.courseUrl, input.campaignId);
  const model = JSON.stringify({
    questions: content.reflection.map((question) => ({
      question: question.question,
      options: question.options.map((option) => ({ label: option.label, guidance: option.guidance, signal: option.signal })),
    })),
    outcomes: content.outcomes,
    destination,
    ctaLabel: input.ctaLabel,
  }).replace(/</gu, '\\u003c');

  const script = `"use strict";
(() => {
const model = ${model};
const host = document.getElementById('quiz');
if (!host) return;
const answers = [];
function decide(signals) {
  const counts = { fit: 0, explore: 0, other: 0 };
  for (const signal of signals) counts[signal] += 1;
  const ranked = ['fit', 'other', 'explore'].map((signal) => ({ signal, count: counts[signal] })).sort((a, b) => b.count - a.count);
  if (ranked[0].count === ranked[1].count) return 'explore';
  return ranked[0].signal;
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function progress(index) {
  const list = el('ol', 'progress'); list.setAttribute('aria-label', 'Voortgang');
  model.questions.forEach((_, i) => { const item = el('li', i < index ? 'done' : ''); list.append(item); });
  return list;
}
function show(index) {
  host.replaceChildren();
  const screen = el('section', 'screen');
  if (index < model.questions.length) {
    const question = model.questions[index];
    const heading = el('h2', '', 'Vraag ' + (index + 1) + ' van ' + model.questions.length); heading.tabIndex = -1;
    screen.append(progress(index), heading, el('p', '', question.question));
    question.options.forEach((option, choice) => {
      const button = el('button', 'choice', option.label); button.type = 'button';
      button.addEventListener('click', () => {
        answers[index] = choice;
        const feedback = el('div', 'feedback'); feedback.setAttribute('role', 'status'); feedback.textContent = option.guidance;
        screen.querySelectorAll('.choice').forEach((other) => { other.disabled = true; });
        const next = el('button', 'cta', index + 1 < model.questions.length ? 'Volgende vraag' : 'Bekijk je uitkomst'); next.type = 'button';
        next.addEventListener('click', () => show(index + 1));
        screen.append(feedback, next); next.focus();
      });
      screen.append(button);
    });
    if (index > 0) { const back = el('button', 'again', 'Vorige vraag'); back.type = 'button'; back.addEventListener('click', () => show(index - 1)); screen.append(back); }
    host.append(screen); heading.focus();
    return;
  }
  const signals = answers.map((choice, i) => model.questions[i].options[choice].signal);
  const outcome = model.outcomes ? model.outcomes[decide(signals)] : null;
  const heading = el('h2', '', outcome ? outcome.title : 'Jouw overwegingen'); heading.tabIndex = -1;
  screen.append(progress(model.questions.length), heading);
  if (outcome) {
    screen.append(el('p', '', outcome.text));
    const steps = el('ul', 'steps'); outcome.nextSteps.forEach((step) => steps.append(el('li', '', step))); screen.append(el('p', '', 'Wat je nu kunt doen:'), steps);
  } else {
    model.questions.forEach((question, i) => { const option = question.options[answers[i]]; if (!option) return; screen.append(el('h3', '', question.question), el('p', '', option.label + ' — ' + option.guidance)); });
  }
  const link = el('a', 'cta', model.ctaLabel); link.href = model.destination; link.target = '_blank'; link.rel = 'noopener noreferrer';
  const again = el('button', 'again', 'Opnieuw beginnen'); again.type = 'button'; again.addEventListener('click', () => { answers.length = 0; show(0); });
  screen.append(link, again, el('p', 'hint', 'Dit is een keuzehulp, geen toelatingstest: geen score, geen garantie. Er worden geen gegevens opgeslagen.'));
  host.append(screen); heading.focus();
}
show(0);
})();
`;

  const draft = input.isMock
    ? '<p class="hint">DEMO · voorbeeldinhoud zonder AI-aanbieder</p>'
    : '<p class="hint">CONCEPT · controleer inhoud en merkstijl vóór gebruik</p>';
  const intro = content.outcomes
    ? `Beantwoord ${String(content.reflection.length)} korte vragen over je eigen situatie. Je krijgt per antwoord een korte reactie en aan het eind een uitkomst met wat je nu het beste kunt doen. Dit is geen toelatingstest en geeft geen score.`
    : 'Verken drie herkenbare situaties en ontdek jouw volgende stap. Dit is geen toelatingstest en geeft geen score of garantie.';
  const noscript = `<noscript><p>Deze keuzehulp heeft JavaScript nodig. <a href="${escape(destination)}">${escape(input.ctaLabel)}</a></p></noscript>`;
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(content.title)}</title><link rel="stylesheet" href="style.css"></head><body><main>${draft}<p><strong>${escape(input.courseName)}</strong></p><h1>${escape(content.title)}</h1><p>${escape(intro)}</p><div id="quiz" aria-live="polite"></div>${noscript}</main><script src="widget.js" defer></script></body></html>`;
  const embed = `<!-- Plak dit op de opleidingspagina, bijvoorbeeld onder de inleiding. Vervang het pad door de plek waar de map keuzehulp/ wordt gehost. -->\n<iframe src="/keuzehulp/index.html" title="Keuzehulp: ${escape(content.title)}" width="100%" height="760" loading="lazy" style="border:0;border-radius:16px"></iframe>`;
  return {
    'keuzehulp/index.html': html,
    'keuzehulp/style.css': QUIZ_CSS,
    'keuzehulp/widget.js': script,
    'keuzehulp/src/widget.ts': script,
    'keuzehulp/embed.html': embed,
  };
}

import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

/**
 * The browser smoke driver may only look for labels that the interface renders.
 *
 * `tools/ui-smoke` finds every control by its visible Dutch label, so a rename
 * in the interface silently breaks it. That happened twice in a row: the driver
 * waited 25 seconds for "Briefing opstellen" and then for "Concepten
 * voorstellen", while the screenshots it had just taken showed "Briefing
 * uitwerken" and "Drie beeldrichtingen voorstellen" on screen. Each discovery
 * cost a full run against the real provider — minutes of wall clock and real
 * money — to learn that a string had been edited.
 *
 * A rename is a one-second edit. The feedback for getting it wrong belongs in
 * the same second, which is what this is.
 *
 * ## What it does not check
 *
 * It is a text search over the web sources: it proves the words exist, not that
 * the control is reachable, enabled, or in the right step. Those are exactly
 * what the browser run is for, and no static check can replace it. The point is
 * narrower — the run should fail on something real, not on a typo.
 */

const DRIVER = 'tools/ui-smoke/index.ts';

/**
 * Labels the driver types, taken from the driver itself.
 *
 * Reading the source rather than importing it keeps this test free of
 * Playwright and of a project reference from the API to `tools/` — the
 * dependency only runs the other way. Three forms are collected:
 *
 *  - `name: 'Pakket goedkeuren'` — a Playwright role name.
 *  - `getByLabel('Naam van de campagne')` — a form field.
 *  - `name: /Briefing v\d+ goedkeuren/u` — a pattern, from which the literal
 *    runs are taken. Interpolated labels can only be matched this way, and the
 *    literal parts are the half that a rename breaks.
 *
 * Label and course *names* are not collected: those come from the database and
 * are configurable per run, so they are data rather than interface text.
 */
async function labelsUsedByTheDriver(): Promise<string[]> {
  const source = await readFile(DRIVER, 'utf8');
  const found = new Set<string>();

  for (const match of source.matchAll(/name:\s*'([^']+)'(?!,\s*ok:)/gu)) {
    found.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/getByLabel\('([^']+)'/gu)) {
    found.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/name:\s*\/((?:[^/\n\\]|\\.)+)\/[a-z]*/gu)) {
    // Anchors, groups, alternation and escapes are separators; what is left
    // between them is text that has to appear on screen. Runs shorter than
    // four characters are dropped as too weak to mean anything.
    for (const run of (match[1] ?? '').split(/[\\^$.|?*+()[\]{}]/u)) {
      if (run.length >= 4) {
        found.add(run);
      }
    }
  }

  return [...found].filter((label) => label.length > 0);
}

/** Every web source file, concatenated once. */
async function webSources(): Promise<string> {
  const parts: string[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
        parts.push(await readFile(full, 'utf8'));
      }
    }
  }

  await walk('apps/web/src');
  await walk('packages/ui/src');
  // Interface text that is *vocabulary* — objective and stage labels — lives
  // in the contract so the API, the worker and the interface say the same
  // word. A rename there breaks the driver just as surely.
  await walk('packages/contracts/src');
  return parts.join('\n');
}

describe('the browser smoke driver and the interface agree on their labels', () => {
  it('finds every label the driver looks for in the web sources', async () => {
    const labels = await labelsUsedByTheDriver();

    /*
     * Guards against passing by extracting nothing.
     *
     * If the driver is reformatted so the patterns above stop matching, the
     * loop below would iterate over an empty list and report success — the
     * failure mode where a test dies of its own success. The chain is thirteen
     * steps plus the setup clicks, so the count cannot legitimately be small.
     */
    expect(labels.length).toBeGreaterThanOrEqual(15);

    const sources = await webSources();
    const missing = labels.filter((label) => !sources.includes(label));

    expect(missing).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, BrowserContext, Locator } from 'playwright';
import type {
  AdvertisingReport,
  Advertisement,
  AdPlatform,
} from '@c360/contracts';

const ROOTS = [
  'adstransparency.google.com',
  'www.google.com',
  'www.google.nl',
  'www.gstatic.com',
  'fonts.gstatic.com',
  'fonts.googleapis.com',
  'lh3.googleusercontent.com',
  'displayads-formats.googleusercontent.com',
  'tpc.googlesyndication.com',
  'pagead2.googlesyndication.com',
  'www.facebook.com',
  'static.xx.fbcdn.net',
  'www.linkedin.com',
  'static.licdn.com',
  'media.licdn.com',
];
export function allowedAdResource(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (ROOTS.includes(u.hostname) ||
        /^(?:[a-z0-9-]+\.)+(?:fbcdn\.net|fbsbx\.com|licdn\.com)$/u.test(
          u.hostname,
        ))
    );
  } catch {
    return false;
  }
}
export function courseAdTerms(name: string): string[] {
  const acronyms = [...name.matchAll(/\(([\p{L}\d® -]{3,30})\)/gu)].map((m) =>
    m[1]!.replace(/®/gu, '').trim(),
  );
  const full = name
    .replace(/\([^)]*\)/gu, '')
    .replace(/^(?:opleiding|cursus|training)\s+/iu, '')
    .trim();
  return [...new Set([...acronyms, full])]
    .filter((s) => s.length >= 3)
    .slice(0, 4);
}
export function matchAdTerms(text: string, terms: readonly string[]): string[] {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  return terms.filter((term) =>
    ` ${normalized} `.includes(
      ` ${term
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()} `,
    ),
  );
}
export function metaStatus(text: string): Advertisement['status'] {
  return /^Niet-actief\s*$/imu.test(text)
    ? 'inactive'
    : /^Actief\s*$/imu.test(text)
      ? 'active'
      : 'unknown';
}
export function adSearches(
  name: string,
  domain: string | null,
  competitorUrls: readonly string[] = [],
): { platform: AdPlatform; url: string; query: string }[] {
  const term = courseAdTerms(name)[0] ?? name;
  const google = new URL('https://adstransparency.google.com/');
  google.searchParams.set('region', 'NL');
  if (domain) google.searchParams.set('domain', domain);
  const meta = new URL('https://www.facebook.com/ads/library/');
  for (const [k, v] of Object.entries({
    active_status: 'all',
    ad_type: 'all',
    country: 'NL',
    q: term,
    search_type: 'keyword_unordered',
  }))
    meta.searchParams.set(k, v);
  const linkedin = new URL('https://www.linkedin.com/ad-library/search');
  linkedin.searchParams.set('keyword', term);
  linkedin.searchParams.set('countries', 'NL');
  const extraDomains = [
    ...new Set(
      competitorUrls.flatMap((value) => {
        try {
          const u = new URL(value);
          const host = u.hostname.replace(/^www\./u, '');
          return u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            host !== domain?.replace(/^www\./u, '') &&
            /^[a-z0-9.-]+\.[a-z]{2,}$/u.test(host)
            ? [host]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ].slice(0, 2);
  return [
    ...extraDomains.map((host) => ({
      platform: 'google' as const,
      url: `https://adstransparency.google.com/?region=NL&domain=${encodeURIComponent(host)}`,
      query: host,
    })),
    { platform: 'google', url: google.href, query: domain ?? name },
    { platform: 'meta', url: meta.href, query: term },
    { platform: 'linkedin', url: linkedin.href, query: term },
  ];
}
export interface AdResearchInput {
  courseName: string;
  courseUrl: string | null;
  competitorUrls?: readonly string[];
  storageRoot: string;
  enabled: boolean;
  executablePath?: string | undefined;
  onPlatform?: (platform: AdPlatform, index: number) => Promise<void>;
}
const blocked = (text: string): boolean =>
  /you have been blocked|captcha|access denied|temporarily blocked|bevestig dat je|unusual traffic|verify you are human/iu.test(
    text,
  );
async function frameText(locator: Locator): Promise<string> {
  const chunks = [await locator.innerText().catch(() => '')];
  for (const frame of await locator.locator('iframe').elementHandles()) {
    const content = await frame.contentFrame();
    if (content)
      chunks.push(
        await content
          .locator('body')
          .innerText({ timeout: 1500 })
          .catch(() => ''),
      );
  }
  return chunks.filter(Boolean).join('\n').slice(0, 12000);
}
async function screenshot(
  locator: Locator,
  root: string,
  id: string,
): Promise<boolean> {
  try {
    await locator.screenshot({
      path: path.join(root, `${id}.png`),
      timeout: 5000,
      animations: 'disabled',
    });
    return true;
  } catch {
    return false;
  }
}
async function guard(context: BrowserContext): Promise<void> {
  let requests = 0;
  await context.route('**/*', async (route) => {
    requests += 1;
    if (requests > 1200 || !allowedAdResource(route.request().url()))
      await route.abort();
    else await route.continue();
  });
}
export async function collectAdvertisements(
  input: AdResearchInput,
): Promise<AdvertisingReport> {
  let domain: string | null = null;
  try {
    if (input.courseUrl) domain = new URL(input.courseUrl).hostname;
  } catch {
    /* No invented domain. */
  }
  const searches = adSearches(input.courseName, domain, input.competitorUrls);
  const report: AdvertisingReport = { ads: [], coverage: [] };
  const unavailable = (note: string): AdvertisingReport => ({
    ads: [],
    coverage: searches.map((s) => ({
      platform: s.platform,
      searchUrl: s.url,
      query: s.query,
      checkedAt: new Date().toISOString(),
      status: 'unavailable',
      scannedCount: 0,
      matchedCount: 0,
      note,
    })),
  });
  if (!input.enabled)
    return unavailable(
      'Automatische advertentieverzameling is niet ingeschakeld. Open de bibliotheek om zelf te controleren.',
    );
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless: true,
      ...(input.executablePath ? { executablePath: input.executablePath } : {}),
    });
  } catch {
    return unavailable(
      'De onderzoeksbrowser kon niet starten. Beheer: installeer Chromium met npx playwright install chromium.',
    );
  }
  const folder = path.join(input.storageRoot, 'radar-advertisements');
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, '.gitignore'), '*\n');
    for (const [index, search] of searches.entries()) {
      await input.onPlatform?.(search.platform, index);
      const context = await browser.newContext({
        locale: 'nl-NL',
        viewport: { width: 1280, height: 960 },
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      await guard(context);
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const timeout = setTimeout(() => {
        void context.close().catch(() => undefined);
      }, 75000);
      const checkedAt = new Date().toISOString();
      const before = report.ads.length;
      try {
        if (
          search.platform === 'google' &&
          !new URL(search.url).searchParams.has('domain')
        ) {
          report.coverage.push({
            platform: search.platform,
            searchUrl: search.url,
            query: search.query,
            checkedAt,
            status: 'unavailable',
            scannedCount: 0,
            matchedCount: 0,
            note: 'Geen website bij deze opleiding; Google zoekt op adverteerder of domein.',
          });
          continue;
        }
        await page.goto(search.url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(search.platform === 'meta' ? 6500 : 2500);
        const body = await page.locator('body').innerText();
        if (blocked(body)) {
          report.coverage.push({
            platform: search.platform,
            searchUrl: search.url,
            query: search.query,
            checkedAt,
            status: 'blocked',
            scannedCount: 0,
            matchedCount: 0,
            note: 'De bibliotheek blokkeert automatische toegang. Er is niet vastgesteld of er advertenties zijn.',
          });
          continue;
        }
        let scanned = 0;
        if (search.platform === 'google')
          scanned = await collectGoogle(
            page,
            input,
            folder,
            report.ads,
            search.query === domain ? 'course_domain' : 'other_or_unconfirmed',
          );
        if (search.platform === 'meta')
          scanned = await collectMeta(page, input, folder, report.ads);
        if (search.platform === 'linkedin')
          scanned = await collectLinkedIn(page, input, folder, report.ads);
        const count = report.ads.length - before;
        report.coverage.push({
          platform: search.platform,
          searchUrl: search.url,
          query: search.query,
          checkedAt,
          status: scanned > 0 ? 'limited' : 'unavailable',
          scannedCount: scanned,
          matchedCount: count,
          note:
            scanned > 0
              ? `${String(scanned)} zichtbare records gecontroleerd; ${String(count)} met een letterlijke opleidingsmatch. Dit is een begrensde steekproef, geen volledig overzicht. Geen match betekent niet dat er geen advertenties zijn.`
              : 'Geen leesbare advertentierecords verkregen. De pagina kan leeg, interactief of afgeschermd zijn; afwezigheid van advertenties is niet vastgesteld.',
        });
      } catch {
        report.coverage.push({
          platform: search.platform,
          searchUrl: search.url,
          query: search.query,
          checkedAt,
          status: 'failed',
          scannedCount: 0,
          matchedCount: report.ads.length - before,
          note: 'De controle kon niet volledig worden afgerond. Eventueel al gevonden advertenties blijven behouden.',
        });
      } finally {
        clearTimeout(timeout);
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  return report;
}
async function collectGoogle(
  page: Page,
  input: AdResearchInput,
  folder: string,
  ads: Advertisement[],
  scope: Advertisement['advertiserScope'],
): Promise<number> {
  const firstNew = ads.length;
  const all = page.getByText('See all ads', { exact: true });
  if (await all.count()) {
    await all.click();
    await page.waitForTimeout(1500);
  }
  const cards = page.locator('creative-preview');
  const count = Math.min(await cards.count(), 40);
  const terms = courseAdTerms(input.courseName);
  let matched = 0;
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const text = await frameText(card);
    const matchedTerms = matchAdTerms(text, terms);
    if (!matchedTerms.length || matched >= 8) continue;
    const href = await card
      .locator('a[href*="/creative/"]')
      .first()
      .getAttribute('href');
    if (!href || !/\/advertiser\/AR\d+\/creative\/CR\d+/u.test(href)) continue;
    const sourceUrl = new URL(href, 'https://adstransparency.google.com').href;
    const libraryId = /\/creative\/(CR\d+)/u.exec(href)?.[1] ?? '';
    if (ads.some((a) => a.platform === 'google' && a.libraryId === libraryId))
      continue;
    const id = randomUUID();
    const advertiser = await card
      .locator('.advertiser-name')
      .innerText()
      .catch(() => 'Adverteerder op de bronpagina');
    ads.push({
      id,
      platform: 'google',
      libraryId,
      sourceUrl,
      advertiser,
      text,
      status: 'unknown',
      deliveryInfo: null,
      observedAt: new Date().toISOString(),
      screenshot: await screenshot(card, folder, id),
      matchedTerms,
      advertiserScope: scope,
    });
    matched += 1;
  }
  // Detail pages establish delivery dates separately from capture time. No live-status inference.
  for (const ad of ads
    .slice(firstNew)
    .filter((a) => a.platform === 'google')
    .slice(0, 3)) {
    try {
      await page.goto(ad.sourceUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 12000,
      });
      await page.waitForTimeout(1000);
      const body = await page.locator('body').innerText();
      const lines = body
        .split('\n')
        .filter((line) =>
          /voor het eerst getoond|voor het laatst weergegeven|indeling:|first shown|last shown|format:/iu.test(
            line,
          ),
        );
      ad.deliveryInfo = lines.length ? lines.join('\n') : null;
    } catch {
      /* Keep the verified library record even when details are unavailable. */
    }
  }
  return count;
}
async function collectMeta(
  page: Page,
  input: AdResearchInput,
  folder: string,
  ads: Advertisement[],
): Promise<number> {
  // Scroll a bounded number of times to let the public library render more records.
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(700);
  }
  const records = await page.locator('div,span').evaluateAll((elements) => {
    const found: { id: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const el of elements as unknown as {
      children: { length: number };
      textContent: string | null;
      innerText: string;
      parentElement: unknown;
      setAttribute(name: string, value: string): void;
    }[]) {
      if (el.children.length) continue;
      const id = /(?:Bibliotheek-ID|Library ID):\s*(\d+)/iu.exec(
        el.textContent ?? '',
      )?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      let container = el;
      for (let level = 0; level < 15 && container.parentElement; level++) {
        const parent = container.parentElement as typeof el;
        const txt = parent.innerText;
        if (
          (txt.match(/(?:Bibliotheek-ID|Library ID):\s*\d+/giu) ?? [])
            .length !== 1
        )
          break;
        container = parent;
      }
      const text = container.innerText;
      if (!/Gesponsord|Sponsored/iu.test(text)) continue;
      container.setAttribute('data-c360-ad', id);
      found.push({ id, text: text.slice(0, 14000) });
    }
    return found.slice(0, 50);
  });
  for (const record of records) {
    const terms = matchAdTerms(record.text, courseAdTerms(input.courseName));
    if (!terms.length || ads.filter((a) => a.platform === 'meta').length >= 8)
      continue;
    const lines = record.text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const sponsored = lines.findIndex((s) =>
      /^(Gesponsord|Sponsored)$/iu.test(s),
    );
    const advertiser =
      sponsored > 0 ? (lines[sponsored - 1] ?? 'Onbekend') : 'Zie bronpagina';
    const id = randomUUID();
    const delivery = lines
      .filter((s) =>
        /Uitgevoerd vanaf|Started running|\d{1,2}\s+[\p{L}.]+\s+\d{4}\s*-\s*/iu.test(
          s,
        ),
      )
      .join('\n');
    ads.push({
      id,
      platform: 'meta',
      libraryId: record.id,
      sourceUrl: `https://www.facebook.com/ads/library/?id=${record.id}`,
      advertiser,
      text: record.text,
      status: metaStatus(record.text),
      deliveryInfo: delivery || null,
      observedAt: new Date().toISOString(),
      screenshot: await screenshot(
        page.locator(`[data-c360-ad="${record.id}"]`),
        folder,
        id,
      ),
      matchedTerms: terms,
      advertiserScope: 'other_or_unconfirmed',
    });
  }
  return records.length;
}
async function collectLinkedIn(
  page: Page,
  input: AdResearchInput,
  folder: string,
  ads: Advertisement[],
): Promise<number> {
  const links = page.locator('a[href*="/ad-library/detail/"]');
  const count = Math.min(await links.count(), 12);
  const urls = await links.evaluateAll((els) =>
    els.map((el) => (el as unknown as { href: string }).href),
  );
  for (const url of [...new Set(urls)].slice(0, 6)) {
    if (
      !/^https:\/\/(?:www\.)?linkedin\.com\/ad-library\/detail\/\d+/u.test(url)
    )
      continue;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    const text = await page.locator('body').innerText();
    if (blocked(text)) break;
    const terms = matchAdTerms(text, courseAdTerms(input.courseName));
    if (!terms.length) continue;
    const id = randomUUID();
    ads.push({
      id,
      platform: 'linkedin',
      libraryId: url.split('/').pop() ?? url,
      sourceUrl: url,
      advertiser: 'Zie advertentiebibliotheek',
      text: text.slice(0, 12000),
      status: 'unknown',
      deliveryInfo: null,
      observedAt: new Date().toISOString(),
      screenshot: await screenshot(page.locator('body'), folder, id),
      matchedTerms: terms,
      advertiserScope: 'other_or_unconfirmed',
    });
  }
  return count;
}

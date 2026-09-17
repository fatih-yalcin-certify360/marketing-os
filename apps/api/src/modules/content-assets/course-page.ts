import type { ServerEnv } from '@c360/config';
import { extractReadableText, safeFetch } from '../../core/net/index.js';

/**
 * The live course page, as text, for the website piece.
 *
 * A change proposal for the course page can only quote what is on the page
 * now, and the choice between "change the page" and "write an article" is
 * made from what the page already says. So the page is read once per
 * generation job, through the same SSRF-guarded fetch and readable-text
 * extraction the course card is built from, and bounded: a course page is a
 * few thousand words, and the prompt does not need more than that.
 *
 * Failure is a value, not an exception. A page that cannot be read means the
 * article form is the only honest one, and the prompt is told so; the job
 * does not fail on someone else's website being down.
 */
export interface CoursePageText {
  url: string;
  text: string;
  retrievedAt: string;
}

/** Enough of a page to judge it and to quote from it; more is prompt weight. */
export const COURSE_PAGE_MAX_CHARS = 12_000;

export async function fetchCoursePageText(
  courseUrl: string | null,
  env: Pick<
    ServerEnv,
    | 'RESEARCH_ALLOWED_HOST_SUFFIXES'
    | 'RESEARCH_ALLOW_HTTP'
    | 'RESEARCH_FETCH_TIMEOUT_MS'
    | 'RESEARCH_MAX_RESPONSE_BYTES'
    | 'RESEARCH_MAX_REDIRECTS'
  >,
): Promise<CoursePageText | null> {
  if (courseUrl === null || courseUrl.trim().length === 0) return null;
  try {
    const fetched = await safeFetch(courseUrl, {
      allowedHostSuffixes: env.RESEARCH_ALLOWED_HOST_SUFFIXES,
      allowInsecureHttp: env.RESEARCH_ALLOW_HTTP,
      timeoutMs: env.RESEARCH_FETCH_TIMEOUT_MS,
      maxResponseBytes: env.RESEARCH_MAX_RESPONSE_BYTES,
      maxRedirects: env.RESEARCH_MAX_REDIRECTS,
    });
    if (!fetched.ok) return null;
    const extracted = extractReadableText(fetched.body, COURSE_PAGE_MAX_CHARS);
    // Fewer than a couple of hundred characters is a consent wall or an
    // error page wearing a 200, not a course page.
    if (extracted.text.length < 200) return null;
    return { url: fetched.finalUrl, text: extracted.text, retrievedAt: fetched.retrievedAt.toISOString() };
  } catch {
    return null;
  }
}

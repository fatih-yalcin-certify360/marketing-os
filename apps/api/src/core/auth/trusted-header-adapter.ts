import { timingSafeEqual } from 'node:crypto';
import type { ServerEnv } from '@c360/config';
import { AppError } from '../errors/app-error.js';
import { TrustedProxyMatcher } from './net.js';
import type { AuthAdapter, AuthenticatedSubject, AuthRequestInput } from './types.js';

/**
 * Production identity: headers written by the company's reverse proxy after it
 * has authenticated the user against Entra ID.
 *
 * The presence of a header is **not** evidence of trust. Three conditions must
 * all hold before a header is read at all:
 *
 *   1. the socket peer address is in `TRUSTED_PROXY_IPS`;
 *   2. the proxy shared secret matches (constant-time compare), when configured;
 *   3. the subject and e-mail headers are single-valued and well-formed.
 *
 * Condition 3 matters more than it looks: a duplicated header arrives as an
 * array, which is the classic way a client smuggles a second value past a
 * proxy that only overwrote the first. Any array is rejected outright.
 *
 * IMPORTANT — not yet complete. The real header contract (names, whether the
 * proxy strips inbound copies, whether it signs its assertions) has not been
 * supplied by the company yet. Until it is, production authentication must be
 * treated as unverified; see docs/security/trusted-header-contract.md.
 */
export class TrustedHeaderAuthAdapter implements AuthAdapter {
  public readonly mode = 'trusted-header' as const;

  private readonly matcher: TrustedProxyMatcher;
  private readonly subjectHeader: string;
  private readonly emailHeader: string;
  private readonly nameHeader: string;
  private readonly secretHeader: string;
  private readonly expectedSecret: Buffer | undefined;

  constructor(env: ServerEnv) {
    this.matcher = new TrustedProxyMatcher(env.TRUSTED_PROXY_IPS);
    this.subjectHeader = env.AUTH_HEADER_SUBJECT.toLowerCase();
    this.emailHeader = env.AUTH_HEADER_EMAIL.toLowerCase();
    this.nameHeader = env.AUTH_HEADER_NAME.toLowerCase();
    this.secretHeader = env.AUTH_HEADER_PROXY_SECRET.toLowerCase();
    this.expectedSecret =
      env.AUTH_PROXY_SHARED_SECRET === undefined
        ? undefined
        : Buffer.from(env.AUTH_PROXY_SHARED_SECRET, 'utf8');
  }

  authenticate(input: AuthRequestInput): AuthenticatedSubject {
    if (!this.matcher.isTrusted(input.remoteAddress)) {
      // Deliberately vague to the client; the detail goes to the log only.
      throw AppError.unauthenticated(
        `identity headers presented from untrusted peer ${input.remoteAddress ?? 'unknown'}`,
      );
    }

    if (this.expectedSecret !== undefined) {
      const presented = singleValue(input.headers[this.secretHeader]);
      if (presented === undefined || !constantTimeEquals(presented, this.expectedSecret)) {
        throw AppError.unauthenticated('proxy shared secret missing or incorrect');
      }
    }

    const externalSubject = singleValue(input.headers[this.subjectHeader]);
    if (externalSubject === undefined) {
      throw AppError.unauthenticated(`missing or duplicated header ${this.subjectHeader}`);
    }
    if (!isPlausibleSubject(externalSubject)) {
      throw AppError.unauthenticated(`malformed subject header ${this.subjectHeader}`);
    }

    const email = singleValue(input.headers[this.emailHeader]);
    if (email === undefined || !isPlausibleEmail(email)) {
      throw AppError.unauthenticated(`missing, duplicated or malformed header ${this.emailHeader}`);
    }

    const displayName = singleValue(input.headers[this.nameHeader]);

    return {
      externalSubject,
      email: email.toLowerCase(),
      displayName: sanitiseDisplayName(displayName) ?? email,
      authMode: 'trusted-header',
    };
  }
}

/**
 * Returns the value only when the header appeared exactly once. A duplicated
 * header is treated as an attack, not as a list to pick from.
 */
function singleValue(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

function constantTimeEquals(presented: string, expected: Buffer): boolean {
  const presentedBuffer = Buffer.from(presented, 'utf8');
  if (presentedBuffer.length !== expected.length) {
    // Length itself is not secret; comparing unequal lengths would throw.
    return false;
  }
  return timingSafeEqual(presentedBuffer, expected);
}

/** Entra ID object ids are UUIDs, but the contract is not fixed, so stay broad
 *  while still refusing control characters, whitespace and absurd lengths. */
function isPlausibleSubject(value: string): boolean {
  return value.length <= 200 && /^[A-Za-z0-9._:@|-]+$/u.test(value);
}

function isPlausibleEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@<>"']+@[^\s@<>"'.]+\.[^\s@<>"']+$/u.test(value);
}

/**
 * Display names come from a directory and end up in HTML. React escapes them,
 * but stripping control characters here keeps them safe for logs and exports
 * too (defence in depth for requirement 13 XSS handling).
 */
function sanitiseDisplayName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex -- intentionally strips C0/C1 controls
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, 200);
}

import type { AuthMode } from '@c360/config';

/**
 * What an identity adapter is allowed to assert.
 *
 * Note what is *not* here: no roles, no label list, no permissions. An adapter
 * establishes *who* the caller is; what they may do is derived server-side from
 * membership rows. This is the structural reason a forged `X-Roles` header
 * cannot escalate privilege (requirement 13: "İstemcinin gönderdiği role/label
 * alanları yetki kaynağı olamaz").
 */
export interface AuthenticatedSubject {
  /** Stable external identifier — Entra ID object id in production. */
  externalSubject: string;
  email: string;
  displayName: string;
  authMode: AuthMode;
}

export interface AuthAdapter {
  readonly mode: AuthMode;
  /**
   * Resolves the caller, or throws `AppError.unauthenticated`. Must not
   * consult the database; user provisioning happens in the identity module.
   */
  authenticate(input: AuthRequestInput): AuthenticatedSubject;
}

/** The only request facts an adapter may look at. */
export interface AuthRequestInput {
  /** Lower-cased header names to values, as Node delivers them. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The socket peer address — not any forwarded-for header. */
  remoteAddress: string | undefined;
}

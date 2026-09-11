import { createHmac } from 'node:crypto';
import type { DbOrTx } from '../../core/db/types.js';
import { auditEvents } from '../../core/db/schema.js';

/**
 * Security audit trail.
 *
 * Scope discipline (requirement 13): this records *access decisions*, not
 * content. Prompts, documents, model output, tokens and raw IP addresses must
 * never reach this table. `metadata` is size-capped and string-only so a
 * careless caller cannot smuggle a payload into it.
 */

export type AuditOutcome = 'allowed' | 'denied' | 'error';
export type AuditActorKind = 'user' | 'system' | 'worker';

export interface AuditEntry {
  organizationId: string;
  labelId?: string | null;
  actorKind: AuditActorKind;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: AuditOutcome;
  reason?: string | null;
  requestId?: string | null;
  /** Raw client address. Hashed before storage; never persisted as-is. */
  clientAddress?: string | undefined;
  metadata?: Record<string, string | number | boolean>;
}

const MAX_METADATA_KEYS = 12;
const MAX_METADATA_VALUE_LENGTH = 200;

export class AuditService {
  /**
   * @param ipHashSecret Salt for address hashing. Without it, a short IP space
   *   would be trivially reversible by brute force, so a missing secret means
   *   addresses are simply not recorded rather than recorded weakly.
   */
  constructor(private readonly ipHashSecret: string | undefined) {}

  async record(db: DbOrTx, entry: AuditEntry): Promise<void> {
    await db.insert(auditEvents).values({
      organizationId: entry.organizationId,
      labelId: entry.labelId ?? null,
      actorKind: entry.actorKind,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      requestId: entry.requestId ?? null,
      ipHash: this.hashAddress(entry.clientAddress),
      metadata: sanitiseMetadata(entry.metadata),
    });
  }

  private hashAddress(address: string | undefined): string | null {
    if (address === undefined || this.ipHashSecret === undefined) {
      return null;
    }
    return createHmac('sha256', this.ipHashSecret).update(address).digest('base64url').slice(0, 32);
  }
}

/**
 * Drops anything that is not a short scalar. This is a hard boundary, not a
 * convenience: it is what keeps user content out of the audit log by
 * construction rather than by reviewer vigilance.
 */
export function sanitiseMetadata(
  metadata: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  if (metadata === undefined) {
    return {};
  }
  const result: Record<string, string | number | boolean> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (keys >= MAX_METADATA_KEYS) {
      break;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      keys += 1;
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
      keys += 1;
    }
  }
  return result;
}

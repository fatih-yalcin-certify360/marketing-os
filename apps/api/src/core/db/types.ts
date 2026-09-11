import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Schema } from './schema.js';

/**
 * The database handle every repository accepts.
 *
 * Repositories are written against this type rather than a concrete driver so
 * the same code runs against node-postgres in dev/production and against
 * PGlite in integration tests (ADR-0010).
 */
export type Db = NodePgDatabase<Schema>;

/**
 * A handle that may be either the pool-backed database or an open transaction.
 * Service methods take this so callers can compose several repository calls
 * into one transaction — which is how a job, its budget reservation and its
 * audit row commit atomically.
 */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

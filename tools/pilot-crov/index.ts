import pg from 'pg';
import { z } from 'zod';

/** Local pilot provisioning, separate from demo seeds and concurrent P1-5.
 * Existing labels, campaigns and course versions are never overwritten.
 * Run from repository root: node --env-file=.env --import tsx tools/pilot-crov/index.ts */
const COURSE_URL = 'https://cs-opleidingen.nl/opleidingen/casemanager-regie-op-verzuim-crov';
const API = 'http://127.0.0.1:4000/api/v1';
const actorSchema = z.object({ userId: z.uuid(), organizationId: z.uuid(), orgRole: z.string() });
const courseListSchema = z.object({ items: z.array(z.object({
  course: z.object({ id: z.uuid(), courseUrl: z.string().nullable(), name: z.string() }),
})) });
const jobSchema = z.object({ id: z.uuid(), status: z.string() });

async function api(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Local API returned HTTP ${String(response.status)}`);
  return response.json();
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || process.env.NODE_ENV === 'production' ||
    (process.env.AUTH_MODE ?? 'local') !== 'local' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) {
    throw new Error('Pilot provisioning is restricted to a local development database and local auth.');
  }
  const actor = actorSchema.parse(await api('/me'));
  if (actor.orgRole !== 'org_owner') throw new Error('Local pilot provisioning requires the organization owner.');
  const db = new pg.Client({ connectionString });
  await db.connect();
  let labelId: string;
  try {
    await db.query('BEGIN');
    const owner = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND org_role='org_owner' AND auth_source='local' AND is_active",
      [actor.userId, actor.organizationId],
    );
    if (owner.rows.length !== 1) throw new Error('API identity does not match the local database owner.');
    await db.query(
      "INSERT INTO labels (organization_id,slug,name,origin) VALUES ($1,'cs-opleidingen','CS Opleidingen','external') ON CONFLICT (organization_id,slug) DO NOTHING",
      [actor.organizationId],
    );
    const labels = await db.query<{ id: string }>(
      "SELECT id FROM labels WHERE organization_id=$1 AND slug='cs-opleidingen' AND is_active",
      [actor.organizationId],
    );
    const found = labels.rows[0]?.id;
    if (!found) throw new Error('CS Opleidingen label is unavailable.');
    labelId = found;
    // The local owner already administers this organization; the membership
    // makes the newly requested pilot appear in the existing label switcher.
    await db.query(
      "INSERT INTO memberships (organization_id,user_id,label_id,role) VALUES ($1,$2,$3,'label_manager') ON CONFLICT (user_id,label_id) DO NOTHING",
      [actor.organizationId, actor.userId, labelId],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }

  const courses = courseListSchema.parse(await api(`/labels/${labelId}/courses`));
  const existing = courses.items.find(({ course }) => course.courseUrl === COURSE_URL);
  if (existing) {
    process.stdout.write(`${JSON.stringify({ labelId, courseId: existing.course.id, alreadyPrepared: true })}\n`);
    return;
  }
  const job = jobSchema.parse(await api(`/labels/${labelId}/courses/extract-from-url`, {
    url: COURSE_URL, courseKey: 'crov',
  }));
  process.stdout.write(`${JSON.stringify({ labelId, jobId: job.id, status: job.status, courseUrl: COURSE_URL })}\n`);
}

void main().catch((error: unknown) => {
  // Never print connection strings, credentials, or raw HTTP response bodies.
  process.stderr.write(`Pilot preparation failed (${error instanceof Error ? error.name : 'unknown error'}).\n`);
  process.exitCode = 1;
});

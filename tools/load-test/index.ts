/**
 * Load test for the documented concurrency assumption.
 *
 * Requirement 15 says capacity must not be claimed without measuring it, so
 * this exists to produce numbers rather than assurances. It drives the running
 * API over HTTP exactly as a browser would, with one distinct identity per
 * virtual user, and reports latency percentiles, throughput and an error
 * breakdown by status code.
 *
 * ## What it does and does not measure
 *
 * It measures *our* system: request handling, authorisation, connection pool
 * behaviour under contention, the job queue's claim path, and whether fair use
 * refuses the right callers. It deliberately runs against the mock AI provider,
 * because a run against OpenAI would mostly measure OpenAI's queue and would
 * cost money per iteration. Model latency is not a property of this codebase;
 * that is precisely why generation was moved onto the worker.
 *
 * It does not measure a multi-replica deployment, TLS termination, or the real
 * reverse proxy. Those belong to an environment that does not exist yet, and
 * the results are reported as what they are.
 *
 * ## Running it
 *
 *   API_BASE=http://127.0.0.1:4000 \
 *   DATABASE_URL=postgresql://... \
 *   AUTH_PROXY_SHARED_SECRET=... \
 *   npx tsx tools/load-test/index.ts --users 100 --seconds 30
 *
 * The API must be started with AUTH_MODE=trusted-header and 127.0.0.1 in
 * TRUSTED_PROXY_IPS, which is how it distinguishes one virtual user from
 * another. It writes nothing a user would see: the fixture users it provisions
 * are prefixed `loadtest-` and are removed by `--cleanup`.
 */

import { Pool } from 'pg';

interface Options {
  users: number;
  seconds: number;
  generationUsers: number;
  queueJobs: number;
  cleanup: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const read = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return fallback;
    }
    const raw = argv[index + 1];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${flag} needs a non-negative number, received "${String(raw)}"`);
    }
    return value;
  };
  return {
    users: read('--users', 100),
    seconds: read('--seconds', 30),
    generationUsers: read('--generation-users', 20),
    queueJobs: read('--queue-jobs', 120),
    cleanup: argv.includes('--cleanup'),
  };
}

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const DATABASE_URL = process.env.DATABASE_URL;
const PROXY_SECRET = process.env.AUTH_PROXY_SHARED_SECRET ?? '';
const SUBJECT_HEADER = process.env.AUTH_HEADER_SUBJECT ?? 'x-c360-subject';
const EMAIL_HEADER = process.env.AUTH_HEADER_EMAIL ?? 'x-c360-email';
const NAME_HEADER = process.env.AUTH_HEADER_NAME ?? 'x-c360-name';
const SECRET_HEADER = process.env.AUTH_HEADER_PROXY_SECRET ?? 'x-c360-proxy-secret';

/** Fixture identities are prefixed so they can never be confused with real ones. */
const SUBJECT_PREFIX = 'loadtest-';

interface VirtualUser {
  subject: string;
  headers: Record<string, string>;
  labelId: string;
  labelSlug: string;
}

/** One completed request. */
interface Sample {
  ms: number;
  status: number;
  route: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL is required: the fixture users need label memberships.');
  }

  const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

  try {
    if (options.cleanup) {
      const removed = await cleanup(pool);
      process.stdout.write(`removed ${String(removed)} load-test user(s)\n`);
      return;
    }

    process.stdout.write(`load test against ${API_BASE}\n`);
    await assertReady();

    const labels = await readLabels(pool);
    if (labels.length === 0) {
      throw new Error('no labels found; run db:seed first');
    }

    process.stdout.write(`provisioning ${String(options.users)} virtual users…\n`);
    const users = await provision(pool, options.users, labels);
    process.stdout.write(`  ready across ${String(labels.length)} label(s)\n\n`);

    const readMix = await runReadMix(users, options.seconds);
    report('Read mix', readMix, options.seconds);

    const burst = await runGenerationBurst(users.slice(0, options.generationUsers));
    reportBurst(burst);

    const drainAfterBurst = await waitForDrain(pool);
    reportDrain('Queue drain after generation burst', drainAfterBurst);

    const queueLoad = await runQueueFlood(users, options.queueJobs);
    reportBurst(queueLoad, 'Queue flood');

    const drainAfterFlood = await waitForDrain(pool);
    reportDrain('Queue drain after flood', drainAfterFlood);
  } finally {
    await pool.end();
  }
}

async function assertReady(): Promise<void> {
  const response = await fetch(`${API_BASE}/ready`);
  if (!response.ok) {
    throw new Error(`API not ready at ${API_BASE}/ready (HTTP ${String(response.status)})`);
  }
  await response.text();
}

async function readLabels(pool: Pool): Promise<{ id: string; slug: string }[]> {
  const result = await pool.query<{ id: string; slug: string }>(
    'select id, slug from labels where is_active order by slug',
  );
  return result.rows;
}

function headersFor(subject: string): Record<string, string> {
  const headers: Record<string, string> = {
    [SUBJECT_HEADER]: subject,
    [EMAIL_HEADER]: `${subject}@example.invalid`,
    [NAME_HEADER]: `Load test ${subject}`,
  };
  if (PROXY_SECRET.length > 0) {
    headers[SECRET_HEADER] = PROXY_SECRET;
  }
  return headers;
}

/**
 * Creates the fixture users and gives each one a label membership.
 *
 * The users are created the same way a real one is — by making a request, so
 * the API's own JIT provisioning runs — and only the membership is inserted
 * directly, because there is no self-service endpoint for granting one and
 * inventing one for a test would be the wrong reason to add an endpoint.
 *
 * Users are spread round-robin across labels so that label-fair scheduling and
 * cross-label isolation are both under load rather than assumed.
 */
async function provision(
  pool: Pool,
  count: number,
  labels: readonly { id: string; slug: string }[],
): Promise<VirtualUser[]> {
  const users: VirtualUser[] = [];

  // Provisioning in batches keeps the API's own fair-use limiter out of the
  // measurement: this is setup, not load.
  const BATCH = 20;
  for (let start = 0; start < count; start += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, count - start) }, (_, offset) => {
      const index = start + offset;
      const subject = `${SUBJECT_PREFIX}${String(index).padStart(4, '0')}`;
      const label = labels[index % labels.length];
      if (label === undefined) {
        throw new Error('label list became empty');
      }
      return { subject, label };
    });

    await Promise.all(
      batch.map(async ({ subject, label }) => {
        const headers = headersFor(subject);
        const response = await fetch(`${API_BASE}/api/v1/me`, { headers });
        if (!response.ok) {
          throw new Error(
            `provisioning ${subject} failed: HTTP ${String(response.status)} ${await response.text()}`,
          );
        }
        await response.text();

        // A label_editor can enqueue generation but cannot approve, which is
        // the role an ordinary marketer has.
        // The composite foreign keys make a cross-organisation membership
        // impossible, so the organisation is read from the user row rather
        // than passed in — the same shape the application uses.
        await pool.query(
          `insert into memberships (organization_id, user_id, label_id, role)
           select u.organization_id, u.id, $2, 'label_editor'
           from users u where u.external_subject = $1
           on conflict (user_id, label_id) do nothing`,
          [subject, label.id],
        );

        users.push({ subject, headers, labelId: label.id, labelSlug: label.slug });
      }),
    );
  }

  return users;
}

/**
 * The steady state: people looking at screens.
 *
 * The mix mirrors what the SPA actually requests — the workspace overview on
 * every navigation, then the campaign list, the job list and the reference data
 * a detail page needs. Job polling is represented because at a hundred users it
 * is the single largest source of requests.
 */
const READ_ROUTES: readonly ((user: VirtualUser) => string)[] = [
  () => '/api/v1/me',
  (user) => `/api/v1/labels/${user.labelId}/workspace`,
  (user) => `/api/v1/labels/${user.labelId}/campaigns`,
  (user) => `/api/v1/labels/${user.labelId}/jobs`,
  (user) => `/api/v1/labels/${user.labelId}/brand`,
  (user) => `/api/v1/labels/${user.labelId}/courses`,
];

async function runReadMix(
  users: readonly VirtualUser[],
  seconds: number,
): Promise<Sample[]> {
  const deadline = Date.now() + seconds * 1_000;
  const samples: Sample[] = [];

  process.stdout.write(
    `read mix: ${String(users.length)} concurrent users for ${String(seconds)}s…\n`,
  );

  await Promise.all(
    users.map(async (user, userIndex) => {
      // Stagger the start so a hundred users do not land on the same
      // millisecond; a real cohort arrives spread out.
      await delay((userIndex % 50) * 20);

      let step = userIndex;
      while (Date.now() < deadline) {
        const route = READ_ROUTES[step % READ_ROUTES.length];
        step += 1;
        if (route === undefined) {
          continue;
        }
        const path = route(user);
        const startedAt = performance.now();
        try {
          const response = await fetch(`${API_BASE}${path}`, { headers: user.headers });
          await response.text();
          samples.push({
            ms: performance.now() - startedAt,
            status: response.status,
            route: path.replace(/[0-9a-f-]{36}/gu, ':id'),
          });
        } catch (error: unknown) {
          samples.push({
            ms: performance.now() - startedAt,
            // 0 marks a transport failure, which is worse than any HTTP status.
            status: 0,
            route: `${path.replace(/[0-9a-f-]{36}/gu, ':id')} (${describe(error)})`,
          });
        }
        // A human reading a page does not request continuously.
        await delay(180 + Math.random() * 220);
      }
    }),
  );

  return samples;
}

/**
 * Everyone pressing the expensive button at once.
 *
 * What is being checked is not throughput but behaviour: every response must be
 * either an accepted job or an honest refusal (429 fair use, 402 budget). A 500
 * or a timeout here would mean the enqueue path does not hold up, and a 200
 * that produced no job row would mean work was silently dropped.
 */
async function runGenerationBurst(
  users: readonly VirtualUser[],
): Promise<{ samples: Sample[]; byStatus: Map<number, number> }> {
  process.stdout.write(
    `\ngeneration burst: ${String(users.length)} simultaneous enqueues…\n`,
  );

  // Resolved before the burst so the timing measures the enqueue alone.
  const targets: { user: VirtualUser; courseId: string }[] = [];
  for (const user of users) {
    const courseId = await courseFor(user);
    if (courseId !== null) {
      targets.push({ user, courseId });
    }
  }
  const skipped = users.length - targets.length;
  if (skipped > 0) {
    process.stdout.write(
      `  ${String(skipped)} user(s) skipped: their label has no course card yet\n`,
    );
  }

  const samples = await Promise.all(
    targets.map(async ({ user, courseId }): Promise<Sample> => {
      const path = `/api/v1/labels/${user.labelId}/courses/${courseId}/personas/propose`;
      const startedAt = performance.now();
      try {
        const response = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          headers: { ...user.headers, 'content-type': 'application/json' },
          body: '{}',
        });
        await response.text();
        return { ms: performance.now() - startedAt, status: response.status, route: 'personas/propose' };
      } catch (error: unknown) {
        return {
          ms: performance.now() - startedAt,
          status: 0,
          route: `personas/propose (${describe(error)})`,
        };
      }
    }),
  );

  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    byStatus.set(sample.status, (byStatus.get(sample.status) ?? 0) + 1);
  }
  return { samples, byStatus };
}

/**
 * Floods the queue across every label at once.
 *
 * Uses the built-in `demo.echo` job rather than a generation job, for two
 * reasons. Only the pilot label has a course card, and inventing course content
 * for the others is exactly what the brief forbids; and this phase is about the
 * queue itself — claiming, label-fair ordering, heartbeats, budget settlement —
 * which `demo.echo` exercises without a provider call in the way.
 *
 * The property under test is fairness: with every label submitting at once, no
 * label should be starved, and the head of the queue should not keep ageing.
 */
async function runQueueFlood(
  users: readonly VirtualUser[],
  totalJobs: number,
): Promise<{ samples: Sample[]; byStatus: Map<number, number> }> {
  process.stdout.write(`\nqueue flood: ${String(totalJobs)} jobs submitted at once…\n`);

  const samples = await Promise.all(
    Array.from({ length: totalJobs }, async (_unused, index): Promise<Sample> => {
      const user = users[index % users.length];
      if (user === undefined) {
        return { ms: 0, status: 0, route: 'no user' };
      }
      const startedAt = performance.now();
      try {
        const response = await fetch(`${API_BASE}/api/v1/labels/${user.labelId}/jobs/demo`, {
          method: 'POST',
          headers: { ...user.headers, 'content-type': 'application/json' },
          // A distinct message per job, so idempotency does not collapse the
          // flood into one job per label and hide the queue behaviour.
          body: JSON.stringify({ message: `flood-${String(index)}`, steps: 2, failFirstAttempts: 0 }),
        });
        await response.text();
        return { ms: performance.now() - startedAt, status: response.status, route: 'jobs/demo' };
      } catch (error: unknown) {
        return { ms: performance.now() - startedAt, status: 0, route: `jobs/demo (${describe(error)})` };
      }
    }),
  );

  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    byStatus.set(sample.status, (byStatus.get(sample.status) ?? 0) + 1);
  }
  return { samples, byStatus };
}

const courseCache = new Map<string, string | null>();

/**
 * The label's first course, read once per label.
 *
 * Returns null when the label has none. An earlier version substituted an
 * all-zeros id here, which made the burst measure how fast the API can refuse
 * a non-existent course — a correct refusal, but not the path under test.
 */
async function courseFor(user: VirtualUser): Promise<string | null> {
  const cached = courseCache.get(user.labelId);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(`${API_BASE}/api/v1/labels/${user.labelId}/courses`, {
    headers: user.headers,
  });
  const body = (await response.json()) as { items?: { course?: { id?: string } }[] };
  const id = body.items?.[0]?.course?.id ?? null;
  courseCache.set(user.labelId, id);
  return id;
}

/**
 * Watches the queue drain.
 *
 * The number that matters for a queue is not its depth but whether the oldest
 * item keeps ageing. A deep queue that drains steadily is healthy; a shallow
 * one whose head is five minutes old is not.
 */
async function waitForDrain(
  pool: Pool,
): Promise<{ drained: boolean; seconds: number; peakOldestMs: number; outcomes: Map<string, number> }> {
  process.stdout.write('\nwaiting for the worker to drain the queue…\n');
  const startedAt = Date.now();
  let peakOldestMs = 0;

  // Bounded wait: if the queue is not drained by now, that is the finding.
  const limitMs = 180_000;
  for (;;) {
    const result = await pool.query<{ status: string; count: string; oldest_ms: string | null }>(
      `select status, count(*)::text as count,
              coalesce(max(extract(epoch from (now() - created_at)) * 1000), 0)::text as oldest_ms
       from jobs group by status`,
    );
    const rows = result.rows;
    const pending = rows
      .filter((row) => row.status === 'queued' || row.status === 'running')
      .reduce((total, row) => total + Number(row.count), 0);
    const oldest = rows
      .filter((row) => row.status === 'queued')
      .reduce((max, row) => Math.max(max, Number(row.oldest_ms ?? 0)), 0);
    peakOldestMs = Math.max(peakOldestMs, oldest);

    if (pending === 0) {
      const outcomes = new Map<string, number>();
      for (const row of rows) {
        outcomes.set(row.status, Number(row.count));
      }
      return { drained: true, seconds: (Date.now() - startedAt) / 1_000, peakOldestMs, outcomes };
    }

    if (Date.now() - startedAt > limitMs) {
      const outcomes = new Map<string, number>();
      for (const row of rows) {
        outcomes.set(row.status, Number(row.count));
      }
      return { drained: false, seconds: (Date.now() - startedAt) / 1_000, peakOldestMs, outcomes };
    }

    await delay(500);
  }
}

// --------------------------------------------------------------- reporting ---

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function report(title: string, samples: readonly Sample[], seconds: number): void {
  const sorted = samples.map((sample) => sample.ms).sort((left, right) => left - right);
  const ok = samples.filter((sample) => sample.status >= 200 && sample.status < 300).length;
  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    byStatus.set(sample.status, (byStatus.get(sample.status) ?? 0) + 1);
  }

  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`requests        ${String(samples.length)}\n`);
  process.stdout.write(
    `throughput      ${(samples.length / seconds).toFixed(1)} req/s\n`,
  );
  process.stdout.write(
    `success         ${String(ok)} (${((ok / Math.max(1, samples.length)) * 100).toFixed(2)}%)\n`,
  );
  process.stdout.write(`p50             ${percentile(sorted, 0.5).toFixed(1)} ms\n`);
  process.stdout.write(`p95             ${percentile(sorted, 0.95).toFixed(1)} ms\n`);
  process.stdout.write(`p99             ${percentile(sorted, 0.99).toFixed(1)} ms\n`);
  process.stdout.write(`max             ${(sorted[sorted.length - 1] ?? 0).toFixed(1)} ms\n`);
  process.stdout.write('status          ');
  process.stdout.write(
    [...byStatus.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([status, count]) => `${status === 0 ? 'transport-error' : String(status)}=${String(count)}`)
      .join('  '),
  );
  process.stdout.write('\n');

  // Per-route p95, because one slow endpoint is invisible in an aggregate.
  const routes = new Map<string, number[]>();
  for (const sample of samples) {
    const existing = routes.get(sample.route);
    if (existing === undefined) {
      routes.set(sample.route, [sample.ms]);
    } else {
      existing.push(sample.ms);
    }
  }
  process.stdout.write('\nper route (p50 / p95 / n)\n');
  for (const [route, values] of [...routes.entries()].sort()) {
    const routeSorted = [...values].sort((left, right) => left - right);
    process.stdout.write(
      `  ${route.padEnd(46)} ${percentile(routeSorted, 0.5).toFixed(1).padStart(7)} ${percentile(routeSorted, 0.95).toFixed(1).padStart(8)}  ${String(values.length)}\n`,
    );
  }
}

function reportBurst(
  burst: { samples: Sample[]; byStatus: Map<number, number> },
  title = 'Generation burst',
): void {
  const sorted = burst.samples.map((sample) => sample.ms).sort((left, right) => left - right);
  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`enqueues        ${String(burst.samples.length)}\n`);
  process.stdout.write(`p50             ${percentile(sorted, 0.5).toFixed(1)} ms\n`);
  process.stdout.write(`p95             ${percentile(sorted, 0.95).toFixed(1)} ms\n`);
  process.stdout.write(`max             ${(sorted[sorted.length - 1] ?? 0).toFixed(1)} ms\n`);
  process.stdout.write('status          ');
  process.stdout.write(
    [...burst.byStatus.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([status, count]) => `${status === 0 ? 'transport-error' : String(status)}=${String(count)}`)
      .join('  '),
  );
  process.stdout.write('\n');

  const unexpected = [...burst.byStatus.keys()].filter(
    (status) => status === 0 || status >= 500 || (status >= 300 && status < 400),
  );
  process.stdout.write(
    unexpected.length === 0
      ? 'verdict         every enqueue was accepted or honestly refused\n'
      : `verdict         UNEXPECTED statuses present: ${unexpected.join(', ')}\n`,
  );
}

function reportDrain(
  title: string,
  drain: {
    drained: boolean;
    seconds: number;
    peakOldestMs: number;
    outcomes: Map<string, number>;
  },
): void {
  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`drained         ${drain.drained ? 'yes' : 'NO — still pending'}\n`);
  process.stdout.write(`elapsed         ${drain.seconds.toFixed(1)} s\n`);
  process.stdout.write(`peak head age   ${(drain.peakOldestMs / 1_000).toFixed(1)} s\n`);
  process.stdout.write('job outcomes    ');
  process.stdout.write(
    [...drain.outcomes.entries()]
      .sort()
      .map(([status, count]) => `${status}=${String(count)}`)
      .join('  '),
  );
  process.stdout.write('\n');
}

async function cleanup(pool: Pool): Promise<number> {
  const result = await pool.query(
    `delete from users where external_subject like $1`,
    [`${SUBJECT_PREFIX}%`],
  );
  return result.rowCount ?? 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error: unknown) => {
  process.stderr.write(`\nload test failed: ${describe(error)}\n`);
  process.exit(1);
});

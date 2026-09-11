import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Boots a throwaway stack, runs the browser smoke against it, tears it down.
 *
 * This is what makes the smoke run usable in CI. Three properties matter:
 *
 *  - **It costs nothing and needs no key.** `AI_PROVIDER=mock` produces
 *    clearly-labelled deterministic output, so the run exercises the *product*
 *    — the gates, the queue, the render layer, the export — rather than the
 *    model. Running it against a real provider stays possible and is a
 *    deliberate, separate act (`npx tsx tools/ui-smoke/index.ts`), because it
 *    costs roughly one campaign each time.
 *  - **It shares nothing.** Its own PGlite data directory in a temp folder, its
 *    own ports, its own storage root. Pointing it at a database someone is
 *    working in would make a failure ambiguous, and a smoke run that can
 *    disturb real work will not be run.
 *  - **It always tears down.** Orphaned Node processes holding ports are how a
 *    developer ends up debugging yesterday's stack; a stale worker once spent
 *    sixteen hours failing every job of a type it did not know.
 *
 * Every port and path is overridable so a developer can run this while their
 * normal stack is up.
 */

const PORTS = {
  db: process.env.SMOKE_DB_PORT ?? '5455',
  api: process.env.SMOKE_API_PORT ?? '4055',
  workerHealth: process.env.SMOKE_WORKER_HEALTH_PORT ?? '4056',
  web: process.env.SMOKE_WEB_PORT ?? '5255',
};

const children: { name: string; child: ChildProcess; output: string[] }[] = [];
let shuttingDown = false;

/**
 * The tail of a server's output, for when the smoke fails.
 *
 * Kept rather than streamed: four interleaved server logs bury the smoke's own
 * output, which is the product of the run. But a failure without them is
 * guesswork — a run answered 403 on a request that the same API accepted from
 * curl, and the reason was in a log this runner had thrown away.
 */
function dumpLogs(): void {
  for (const { name, output } of children) {
    const lines = output.join('').split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      continue;
    }
    process.stdout.write(`\n[with-stack] last output from ${name}:\n`);
    for (const line of lines.slice(-20)) {
      process.stdout.write(`    ${line.slice(0, 400)}\n`);
    }
  }
}

function start(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): ChildProcess {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd === undefined ? {} : { cwd }),
  });
  // Kept quiet unless something goes wrong: the smoke output is the product of
  // this run, and four interleaved server logs bury it.
  const output: string[] = [];
  const remember = (chunk: Buffer): void => {
    output.push(chunk.toString());
    // Bounded, so a chatty server cannot grow this without limit.
    if (output.length > 400) {
      output.splice(0, output.length - 400);
    }
  };
  child.stdout?.on('data', remember);
  child.stderr?.on('data', remember);
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      process.stdout.write(`\n[with-stack] ${name} exited with code ${String(code)}\n`);
    }
  });
  children.push({ name, child, output });
  return child;
}

/**
 * Runs a command to completion.
 *
 * `stream` decides whether its output is shown as it happens or kept back
 * until it fails. Migration and seeding are noise when they work; the smoke's
 * own checks are the product of the run and must always be visible — an
 * earlier version buffered them, so a successful run printed nothing at all.
 */
async function run(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stream = false,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (!stream) {
        process.stdout.write(output.split('\n').slice(-20).join('\n') + '\n');
      }
      reject(new Error(`${name} failed with code ${String(code)}`));
    });
    child.on('error', reject);
  });
}

/** Polls a URL until it answers, so nothing races a server that is still binding. */
async function waitForHttp(label: string, url: string, timeoutMs = 90_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${label} did not answer ${url} within ${String(timeoutMs / 1000)}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Polls a TCP port, for the database, which speaks no HTTP. */
async function waitForTcp(label: string, port: number, timeoutMs = 90_000): Promise<void> {
  const { connect } = await import('node:net');
  const started = Date.now();
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) {
      return;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${label} did not open port ${String(port)} within ${String(timeoutMs / 1000)}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  for (const { child } of children) {
    child.kill('SIGTERM');
  }
  // A short grace period, then insist. The worker drains on SIGTERM, and a
  // smoke run has nothing worth draining.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  for (const { child } of children) {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'c360-smoke-'));
  const dataDir = join(workspace, 'db');
  const storageRoot = join(workspace, 'storage');
  const outDir = process.argv[2] ?? './var/ui-shots';

  /*
   * The environment the whole stack shares.
   *
   * `AUTH_PROXY_SHARED_SECRET` is present because the config refuses to start
   * without one when the value is short — a deliberately obvious throwaway,
   * never a value that could be mistaken for a real secret.
   */
  const shared: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    AUTH_MODE: 'local',
    AI_PROVIDER: 'mock',
    AI_IMAGE_ENABLED: 'false',
    DATABASE_URL: `postgresql://c360:c360_dev_password@127.0.0.1:${PORTS.db}/postgres`,
    STORAGE_ROOT: storageRoot,
    AUTH_PROXY_SHARED_SECRET: 'ui-smoke-throwaway-secret-not-a-real-one',
    API_PORT: PORTS.api,
    API_HOST: '127.0.0.1',
    /*
     * The smoke's own web origin has to be declared.
     *
     * Every state-changing request carrying an `Origin` header must match this
     * list, which is a real CSRF control and not a CORS convenience: with no
     * configured origin the API refuses the browser and accepts only requests
     * with no `Origin` at all. That is why the first run of this stack failed
     * on `403 origin_not_allowed` while the same POST succeeded from curl —
     * curl sends no origin. Serving the smoke's web on a non-standard port
     * means telling the API about it, exactly as a deployment must.
     */
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${PORTS.web}`,
    WORKER_HEALTH_PORT: PORTS.workerHealth,
    WORKER_POLL_INTERVAL_MS: '400',
    /*
     * Sized for the Docker-free database, which has a connection budget.
     *
     * `tools/dev-db` allows twelve connections and serialises queries.
     * `DATABASE_POOL_MAX` defaults to twenty **per process**, and this stack
     * runs two — so the defaults ask for forty and the database resets
     * connections under the chain's write bursts, surfacing as `ECONNRESET`
     * from inside an unrelated query. Four each plus two worker slots fits
     * with room to spare, and a single user walking one chain needs nothing
     * more.
     *
     * These same values live in the developer `.env`, which is not committed —
     * so a stack booted anywhere else (CI, a new machine) would hit exactly
     * this and be told only that a socket closed. Set here explicitly for that
     * reason.
     */
    DATABASE_POOL_MAX: '4',
    WORKER_CONCURRENCY: '2',
  };

  process.stdout.write(`[with-stack] workspace ${workspace}\n`);

  try {
    process.stdout.write(`[with-stack] database on ${PORTS.db}\n`);
    start('db', 'npx', ['tsx', 'tools/dev-db/index.ts'], {
      ...shared,
      DEV_DB_PORT: PORTS.db,
      DEV_DB_DATA_DIR: dataDir,
    });
    await waitForTcp('database', Number(PORTS.db));

    process.stdout.write('[with-stack] migrating and seeding\n');
    await run('migrate', 'npx', ['tsx', 'apps/api/src/core/db/cli/migrate.ts'], shared);
    await run('seed', 'npx', ['tsx', 'apps/api/src/core/db/cli/seed.ts'], shared);

    process.stdout.write(`[with-stack] api on ${PORTS.api}, worker, web on ${PORTS.web}\n`);
    start('api', 'npx', ['tsx', 'apps/api/src/index.ts'], shared);
    start('worker', 'npx', ['tsx', 'apps/worker/src/index.ts'], shared);
    await waitForHttp('api', `http://127.0.0.1:${PORTS.api}/health`);

    /*
     * Started inside `apps/web`, not at the repository root.
     *
     * Vite resolves its config from the working directory, and the root has
     * none — so a root-launched Vite served an empty directory and the run
     * failed on a blank page, three steps away from the cause.
     */
    start(
      'web',
      'npx',
      ['vite', '--port', PORTS.web, '--strictPort'],
      { ...shared, VITE_API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}` },
      'apps/web',
    );
    await waitForHttp('web', `http://127.0.0.1:${PORTS.web}/`);

    process.stdout.write('[with-stack] running the smoke\n\n');
    await run(
      'smoke',
      'npx',
      ['tsx', 'tools/ui-smoke/index.ts', outDir],
      {
        ...shared,
        WEB_BASE: `http://127.0.0.1:${PORTS.web}`,
        UI_SMOKE_LABEL_NAME: 'Lindenhaeghe (Demo)',
        UI_SMOKE_COURSE: 'Wft Basis (Demo)',
      },
      true,
    );
  } catch (error: unknown) {
    dumpLogs();
    throw error;
  } finally {
    await shutdown();
    await rm(workspace, { recursive: true, force: true });
    process.stdout.write('\n[with-stack] stack stopped, workspace removed\n');
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`\n[with-stack] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

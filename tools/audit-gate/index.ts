import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluate,
  isSeverity,
  shouldBlock,
  type Acknowledgement,
  type AuditReport,
  type Severity,
} from './evaluate.js';

/**
 * The dependency-vulnerability gate CI runs.
 *
 *   npx tsx tools/audit-gate/index.ts [--threshold high]
 *
 * Exits non-zero when an advisory at or above the threshold has no live
 * acknowledgement, when an acknowledgement has lapsed, or when one no longer
 * matches anything. Everything below the threshold is printed and does not
 * block — those are triaged in `docs/security/vulnerability-management.md`.
 *
 * `npm audit` itself exits non-zero whenever it finds *anything*, which is why
 * the raw command was wrapped in `|| true` and stopped being a gate at all.
 * Here the exit code comes from the policy rather than from the scanner.
 */

const ACKNOWLEDGED = path.join(import.meta.dirname, 'acknowledged.json');

async function runAudit(): Promise<AuditReport> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'npm',
      ['audit', '--json'],
      // A large tree produces a large report; the default 1 MB buffer truncates
      // it, and a truncated JSON body would read as an unparseable report.
      { maxBuffer: 64 * 1024 * 1024 },
      (error, out) => {
        // A non-zero exit is normal: npm reports findings that way. Only an
        // empty body means the command genuinely failed.
        if (out.trim().length === 0) {
          reject(error ?? new Error('npm audit produced no output'));
          return;
        }
        resolve(out);
      },
    );
  });

  try {
    return JSON.parse(stdout) as AuditReport;
  } catch (error) {
    throw new Error(`npm audit did not return JSON: ${String(error)}`, { cause: error });
  }
}

async function loadAcknowledgements(): Promise<Acknowledgement[]> {
  const text = await readFile(ACKNOWLEDGED, 'utf8');
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${ACKNOWLEDGED} must contain an array`);
  }

  return parsed.map((entry, index) => {
    const record = entry as Partial<Acknowledgement>;
    /*
     * Validated rather than trusted. A typo in `expiresOn` that parsed as
     * `Invalid Date` would compare false against every date and silence the
     * advisory for ever — the one failure this file must not have.
     */
    for (const field of ['reason', 'addedOn', 'expiresOn', 'package'] as const) {
      if (typeof record[field] !== 'string' || record[field].length === 0) {
        throw new Error(`acknowledgement ${String(index)} is missing "${field}"`);
      }
    }
    if (typeof record.advisory !== 'number') {
      throw new Error(`acknowledgement ${String(index)} needs a numeric "advisory" id`);
    }
    if (Number.isNaN(new Date(record.expiresOn!).getTime())) {
      throw new Error(
        `acknowledgement ${String(index)} has an unreadable "expiresOn": ${String(record.expiresOn)}`,
      );
    }
    return record as Acknowledgement;
  });
}

function thresholdFromArgv(): Severity {
  const index = process.argv.indexOf('--threshold');
  const value = index === -1 ? 'high' : (process.argv[index + 1] ?? 'high');
  if (!isSeverity(value)) {
    throw new Error(`--threshold must be one of info, low, moderate, high, critical (got ${value})`);
  }
  return value;
}

async function main(): Promise<void> {
  const threshold = thresholdFromArgv();
  const [report, acknowledgements] = await Promise.all([runAudit(), loadAcknowledgements()]);
  const verdict = evaluate({ report, acknowledgements, threshold, now: new Date() });

  process.stdout.write(`dependency audit gate — threshold: ${threshold} and above\n\n`);

  if (verdict.unreadable !== undefined) {
    process.stdout.write(`  CANNOT READ THE REPORT: ${verdict.unreadable}\n`);
    process.exitCode = 1;
    return;
  }

  if (verdict.findings.length === 0) {
    process.stdout.write(`  no advisories at ${threshold} or above\n`);
  }
  for (const finding of verdict.blocking) {
    process.stdout.write(
      `  BLOCKING  ${finding.severity.toUpperCase()} ${finding.package} — ${finding.title}\n` +
        `            advisory ${String(finding.advisory)} · ${finding.url}\n` +
        `            fix available: ${finding.fixAvailable ? 'yes' : 'no'}\n`,
    );
  }
  for (const { finding, acknowledgement } of verdict.accepted) {
    process.stdout.write(
      `  accepted  ${finding.severity.toUpperCase()} ${finding.package} — expires ${acknowledgement.expiresOn}\n` +
        `            ${acknowledgement.reason}\n`,
    );
  }
  for (const { finding, acknowledgement } of verdict.lapsed) {
    process.stdout.write(
      `  LAPSED    ${finding.package} — the acknowledgement expired on ${acknowledgement.expiresOn}\n` +
        `            Re-assess it and either fix the dependency or record a new date and reason.\n`,
    );
  }
  for (const acknowledgement of verdict.stale) {
    process.stdout.write(
      `  STALE     advisory ${String(acknowledgement.advisory)} (${acknowledgement.package}) no longer appears.\n` +
        `            Remove this entry from tools/audit-gate/acknowledged.json.\n`,
    );
  }

  if (shouldBlock(verdict)) {
    process.stdout.write(
      '\nThe policy is in docs/security/vulnerability-management.md. To accept an\n' +
        'advisory, add it to tools/audit-gate/acknowledged.json with a reason and an\n' +
        'expiry date — an exception that cannot lapse is a permanent silence.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\ngate passed\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`\naudit gate failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

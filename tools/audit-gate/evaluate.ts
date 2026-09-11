/**
 * Decides whether an `npm audit` report should block the build.
 *
 * Kept pure and separate from the CLI so it can be tested without invoking npm:
 * the interesting behaviour is the *policy*, not the subprocess.
 *
 * ## Why a gate needs an exception mechanism
 *
 * A blocking threshold with no way to say "we have looked at this one" does not
 * survive contact with a transitive advisory that has no fix. What happens is
 * `|| true` — which is exactly the state this repository was in, with both
 * scanners reporting and neither able to fail a build.
 *
 * So an advisory can be acknowledged, and every acknowledgement **expires**. An
 * exception that cannot lapse is a permanent silence wearing a note.
 */

/** Severity levels npm reports, weakest first. */
const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export function isSeverity(value: string): value is Severity {
  return (SEVERITY_ORDER as readonly string[]).includes(value);
}

function atLeast(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold);
}

/** One entry of a vulnerability's `via` array, when it is an advisory. */
interface AuditVia {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
}

interface AuditVulnerability {
  name?: string;
  severity?: string;
  via?: (string | AuditVia)[];
  fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean };
}

export interface AuditReport {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, AuditVulnerability>;
}

/** A finding, flattened out of the report's nested shape. */
export interface Finding {
  advisory: number;
  package: string;
  severity: Severity;
  title: string;
  url: string;
  fixAvailable: boolean;
}

/** A recorded decision to accept one advisory for a bounded time. */
export interface Acknowledgement {
  advisory: number;
  package: string;
  reason: string;
  addedOn: string;
  /** ISO date. Past this, the acknowledgement no longer suppresses anything. */
  expiresOn: string;
}

export interface Verdict {
  /** Everything at or above the threshold. */
  findings: Finding[];
  /** Findings with no live acknowledgement. These fail the build. */
  blocking: Finding[];
  /** Findings suppressed by a live acknowledgement. */
  accepted: { finding: Finding; acknowledgement: Acknowledgement }[];
  /** Acknowledgements whose date has passed while the finding is still present. */
  lapsed: { finding: Finding; acknowledgement: Acknowledgement }[];
  /** Acknowledgements that no longer match any finding, so they can go. */
  stale: Acknowledgement[];
  /** Set when the report could not be understood at all. */
  unreadable?: string;
}

/**
 * Flattens the report into findings at or above `threshold`.
 *
 * npm nests an advisory under every package that pulls it in, so the same
 * advisory id appears repeatedly; findings are deduplicated by that id. The
 * severity is taken from the advisory itself rather than from the package
 * entry, because the package entry reports the *worst* of its advisories and
 * would over-report the rest.
 */
export function collectFindings(report: AuditReport, threshold: Severity): Finding[] {
  const byAdvisory = new Map<number, Finding>();

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // A string `via` means "vulnerable because of this other package"; the
      // advisory itself is recorded on that other package's own entry.
      if (typeof via === 'string' || via.source === undefined) {
        continue;
      }
      const severity = via.severity ?? vulnerability.severity ?? 'info';
      if (!isSeverity(severity) || !atLeast(severity, threshold)) {
        continue;
      }
      byAdvisory.set(via.source, {
        advisory: via.source,
        package: via.name ?? vulnerability.name ?? packageName,
        severity,
        title: via.title ?? '(no title)',
        url: via.url ?? '',
        fixAvailable: vulnerability.fixAvailable !== false && vulnerability.fixAvailable !== undefined,
      });
    }
  }

  return [...byAdvisory.values()].sort((a, b) => a.advisory - b.advisory);
}

export function evaluate(input: {
  report: AuditReport;
  acknowledgements: readonly Acknowledgement[];
  threshold: Severity;
  now: Date;
}): Verdict {
  const empty: Verdict = { findings: [], blocking: [], accepted: [], lapsed: [], stale: [] };

  /*
   * An unrecognised report is a failure, not a clean bill of health.
   *
   * If npm changes the format, `vulnerabilities` reads as `undefined`, every
   * loop below iterates nothing and the gate reports "no findings" — a check
   * passing because it understood nothing. The version is asserted so that
   * silence is impossible.
   */
  if (input.report.auditReportVersion !== 2) {
    return {
      ...empty,
      unreadable: `unsupported auditReportVersion ${String(
        input.report.auditReportVersion,
      )}; this gate understands version 2. Re-read the report format before trusting a pass.`,
    };
  }

  const findings = collectFindings(input.report, input.threshold);
  const byAdvisory = new Map(findings.map((finding) => [finding.advisory, finding]));

  const accepted: Verdict['accepted'] = [];
  const lapsed: Verdict['lapsed'] = [];
  const stale: Acknowledgement[] = [];
  const suppressed = new Set<number>();

  for (const acknowledgement of input.acknowledgements) {
    const finding = byAdvisory.get(acknowledgement.advisory);
    if (finding === undefined) {
      /*
       * The advisory is gone — usually because the dependency was updated.
       * Reported as a failure rather than ignored: an allow-list nobody prunes
       * grows until it hides the next real finding, and "delete this line" is a
       * ten-second fix with an unambiguous message.
       */
      stale.push(acknowledgement);
      continue;
    }
    if (new Date(acknowledgement.expiresOn).getTime() < input.now.getTime()) {
      lapsed.push({ finding, acknowledgement });
      continue;
    }
    accepted.push({ finding, acknowledgement });
    suppressed.add(acknowledgement.advisory);
  }

  return {
    findings,
    blocking: findings.filter((finding) => !suppressed.has(finding.advisory)),
    accepted,
    lapsed,
    stale,
  };
}

/** True when the verdict should fail the build. */
export function shouldBlock(verdict: Verdict): boolean {
  return (
    verdict.unreadable !== undefined ||
    verdict.blocking.length > 0 ||
    verdict.lapsed.length > 0 ||
    verdict.stale.length > 0
  );
}

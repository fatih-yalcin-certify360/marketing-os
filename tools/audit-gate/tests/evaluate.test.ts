import { describe, expect, it } from 'vitest';
import { collectFindings, evaluate, shouldBlock, type AuditReport } from '../evaluate.js';

/**
 * The dependency gate's policy, tested without invoking npm.
 *
 * The behaviour worth pinning is not "does it find a vulnerability" — npm does
 * that — but what the gate *does* with one, and in particular the three ways a
 * gate like this stops working:
 *
 *  1. it silences something for ever,
 *  2. it accumulates an allow-list nobody prunes, until the list hides the next
 *     real finding,
 *  3. it stops understanding the report and reports a clean build.
 */

const NOW = new Date('2026-09-10T00:00:00.000Z');

function report(vulnerabilities: AuditReport['vulnerabilities']): AuditReport {
  return { auditReportVersion: 2, ...(vulnerabilities === undefined ? {} : { vulnerabilities }) };
}

const HIGH_IN_LEFTPAD = report({
  leftpad: {
    name: 'leftpad',
    severity: 'high',
    fixAvailable: false,
    via: [
      {
        source: 4242,
        name: 'leftpad',
        title: 'Prototype pollution in leftpad',
        url: 'https://example.test/advisories/4242',
        severity: 'high',
      },
    ],
  },
});

describe('the dependency audit gate', () => {
  it('blocks an unacknowledged advisory at the threshold', () => {
    const verdict = evaluate({
      report: HIGH_IN_LEFTPAD,
      acknowledgements: [],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.blocking).toHaveLength(1);
    expect(verdict.blocking[0]?.advisory).toBe(4242);
    expect(verdict.blocking[0]?.fixAvailable).toBe(false);
    expect(shouldBlock(verdict)).toBe(true);
  });

  it('ignores advisories below the threshold', () => {
    const verdict = evaluate({
      report: report({
        esbuild: {
          name: 'esbuild',
          severity: 'low',
          via: [{ source: 1, name: 'esbuild', severity: 'low', title: 'Dev server file read' }],
        },
      }),
      acknowledgements: [],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.findings).toEqual([]);
    expect(shouldBlock(verdict)).toBe(false);
  });

  it('accepts an advisory that has a live acknowledgement', () => {
    const verdict = evaluate({
      report: HIGH_IN_LEFTPAD,
      acknowledgements: [
        {
          advisory: 4242,
          package: 'leftpad',
          reason: 'Build-time only; not present in the runtime image.',
          addedOn: '2026-09-01',
          expiresOn: '2026-12-01',
        },
      ],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.blocking).toEqual([]);
    expect(verdict.accepted).toHaveLength(1);
    expect(shouldBlock(verdict)).toBe(false);
  });

  it('blocks again once the acknowledgement has expired', () => {
    /*
     * The property the whole mechanism exists for. An exception that cannot
     * lapse is a permanent silence wearing a note, and a gate full of those is
     * indistinguishable from no gate.
     */
    const verdict = evaluate({
      report: HIGH_IN_LEFTPAD,
      acknowledgements: [
        {
          advisory: 4242,
          package: 'leftpad',
          reason: 'Waiting for upstream.',
          addedOn: '2026-01-01',
          expiresOn: '2026-06-01',
        },
      ],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.accepted).toEqual([]);
    expect(verdict.lapsed).toHaveLength(1);
    expect(shouldBlock(verdict)).toBe(true);
  });

  it('reports an acknowledgement that no longer matches anything', () => {
    /*
     * Usually because the dependency was updated. Failing rather than ignoring
     * it is deliberate: an allow-list nobody prunes grows until a reader cannot
     * tell which entries are live, and the message says exactly what to do.
     */
    const verdict = evaluate({
      report: report({}),
      acknowledgements: [
        {
          advisory: 4242,
          package: 'leftpad',
          reason: 'Fixed upstream last month.',
          addedOn: '2026-01-01',
          expiresOn: '2026-12-01',
        },
      ],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.stale).toHaveLength(1);
    expect(shouldBlock(verdict)).toBe(true);
  });

  it('refuses to pass a report it cannot read', () => {
    /*
     * The failure that would matter most. With an unrecognised format
     * `vulnerabilities` reads as undefined, every loop iterates nothing, and a
     * gate that understood none of its input announces a clean build.
     */
    const verdict = evaluate({
      report: { auditReportVersion: 3 },
      acknowledgements: [],
      threshold: 'high',
      now: NOW,
    });

    expect(verdict.unreadable).toContain('auditReportVersion 3');
    expect(shouldBlock(verdict)).toBe(true);
  });

  it('counts one advisory once, however many packages pull it in', () => {
    const advisory = {
      source: 99,
      name: 'shared',
      title: 'Something in shared',
      url: 'https://example.test/99',
      severity: 'critical',
    };
    const findings = collectFindings(
      report({
        'package-a': { name: 'package-a', severity: 'critical', via: [advisory, 'package-b'] },
        'package-b': { name: 'package-b', severity: 'critical', via: [advisory] },
      }),
      'high',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.advisory).toBe(99);
  });

  it('takes the severity from the advisory, not from the package entry', () => {
    /*
     * A package entry reports the worst of its advisories. Reading severity
     * from there would promote every other advisory on the same package to that
     * level and block on findings that are genuinely below the threshold.
     */
    const findings = collectFindings(
      report({
        mixed: {
          name: 'mixed',
          severity: 'critical',
          via: [
            { source: 1, name: 'mixed', severity: 'critical', title: 'The bad one' },
            { source: 2, name: 'mixed', severity: 'low', title: 'The mild one' },
          ],
        },
      }),
      'high',
    );

    expect(findings.map((finding) => finding.advisory)).toEqual([1]);
  });
});

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/**
 * `docs/PLATFORM.md` must describe the code that exists.
 *
 * The document's own rule is that a row disagreeing with the code is the row's
 * bug, and this is what makes that checkable. It deliberately does **not**
 * check prose — nobody can test whether a sentence is still true. It checks the
 * one claim that goes stale silently and misleads badly: a named file or
 * directory that has been moved or deleted.
 *
 * Line counts used to be in those tables and were dropped for the same reason
 * in reverse: they went stale on every edit, and a stale number makes a reader
 * distrust the rows that are still correct.
 */

/**
 * Every file and directory in the repository, indexed once.
 *
 * A suffix match against this is more robust than enumerating prefixes: the doc
 * refers to files at whatever depth reads naturally (`ai/generation.ts`,
 * `render/layouts.ts`, `security/threat-model.md`), and a prefix list has to be
 * extended every time a new directory appears — which means the check quietly
 * stops covering the newest code, exactly when it is most useful.
 */
async function indexRepository(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const paths: string[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        paths.push(`${full}/`);
        await walk(full);
      } else {
        paths.push(full);
      }
    }
  }

  /*
   * `reference-banners` holds shipped work we measure our own output against
   * and the document points at by name, so it is indexed like any other source
   * root — but it is deliberately not in the repository (see `.gitignore`): it
   * is large, binary and never imported. A checkout without it is normal, so a
   * missing root is skipped rather than thrown on, and `resolves()` treats
   * anything under an absent bundle as fine.
   */
  for (const root of [...SOURCE_ROOTS, ...REFERENCE_ROOTS]) {
    await walk(root).catch(() => undefined);
  }
  // Repository-root files the doc names directly.
  paths.push('README.md', 'package.json', 'docker-compose.yml');
  return paths;
}

/** Roots that are part of the repository and must always be there. */
const SOURCE_ROOTS = ['apps', 'packages', 'tools', 'docs', 'infra'] as const;

/**
 * Roots that live on disk but not in the repository.
 *
 * Reference material we compare our own work against. The document may name
 * them; a checkout that does not have them is not a broken checkout.
 */
const REFERENCE_ROOTS = ['reference-banners'] as const;

function resolves(candidate: string, index: readonly string[]): boolean {
  const needle = candidate.replace(/^\.\//u, '');
  const bundle = REFERENCE_ROOTS.find((root) => needle.startsWith(`${root}/`));
  if (bundle !== undefined && !existsSync(bundle)) return true;
  return index.some((path) => path === needle || path.endsWith(`/${needle}`));
}

describe('the platform document names only files that exist', () => {
  it('resolves every backticked path', async () => {
    const doc = await readFile('docs/PLATFORM.md', 'utf8');

    // Backticked tokens that look like a path to a source or doc file. Prose
    // identifiers (`safeFetch`, `AppContext`) have no extension and no slash,
    // so they are not matched.
    const candidates = new Set(
      [...doc.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|sql|css|md|json))`/gu)].map(
        (match) => match[1] ?? '',
      ),
    );
    // Bare directory references, written with a trailing slash.
    for (const match of doc.matchAll(/`([A-Za-z0-9_./-]+\/)`/gu)) {
      candidates.add(match[1] ?? '');
    }

    expect(candidates.size).toBeGreaterThan(40);

    const index = await indexRepository();
    const unresolved = [...candidates].filter((candidate) => !resolves(candidate, index));

    expect(unresolved).toEqual([]);
  });

  it('has no stale line or test counts left in the file tables', async () => {
    const doc = await readFile('docs/PLATFORM.md', 'utf8');

    // A row of the form `| `some/file.ts` | 123 | …` is the shape that went
    // stale. Prose may still cite a measured figure; a table column may not.
    const numericRows = [...doc.matchAll(/^\|\s*`[^`]+`\s*\|\s*\d+\s*\|/gmu)];
    expect(numericRows).toEqual([]);
  });

  it('is dated, so a reader knows how fresh it is', async () => {
    const doc = await readFile('docs/PLATFORM.md', 'utf8');
    expect(doc).toMatch(/Last reviewed: \*\*20\d\d-\d\d-\d\d\*\*/u);
  });
});

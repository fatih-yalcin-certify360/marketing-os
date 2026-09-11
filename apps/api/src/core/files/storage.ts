import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, unlink, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where an accepted file goes, and where a file lives while it is still in
 * doubt.
 *
 * Two directories under `STORAGE_ROOT`, and the difference between them is the
 * whole point:
 *
 *  - `quarantine/` — a file that has been received but not yet judged. Nothing
 *    in the product reads from here. Files are removed once they have been
 *    promoted or refused, and a sweep clears anything a crash left behind.
 *  - `uploads/` — accepted, validated files, addressed by the SHA-256 of their
 *    content and served only through an authorised endpoint.
 *
 * Content addressing gives three things for free: an identical re-upload costs
 * no extra bytes, a hostile filename never reaches the filesystem, and a file
 * changing underneath a version that referenced it is detectable.
 *
 * Requirement 13: quarantine unprocessed files; no permanent public URL;
 * clean up temporary files. Threat T-07.
 */

export interface StoredFile {
  readonly sha256: string;
  /** Relative to `STORAGE_ROOT`. Never sent to a client. */
  readonly storagePath: string;
  readonly byteSize: number;
  /** True when the content was already present and nothing was written. */
  readonly deduplicated: boolean;
}

const QUARANTINE_DIR = 'quarantine';
const UPLOAD_DIR = 'uploads';

export class FileStore {
  constructor(private readonly storageRoot: string) {}

  /**
   * Resolves a stored path and proves it stays inside the root.
   *
   * Every read and write goes through here. The check is on the *resolved*
   * path, so `..` segments, symlink-shaped names and absolute paths are all
   * caught by the same test rather than by three string checks.
   */
  absolutePathFor(storagePath: string): string {
    const root = path.resolve(this.storageRoot);
    const resolved = path.resolve(root, storagePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('storage path escapes STORAGE_ROOT');
    }
    return resolved;
  }

  /**
   * Writes received bytes to quarantine.
   *
   * Named with a random id rather than anything from the upload, so the
   * filename cannot influence where it lands. Returns the token needed to
   * promote or discard it.
   */
  async quarantine(bytes: Buffer): Promise<{ token: string; storagePath: string }> {
    const token = randomUUID();
    const storagePath = path.posix.join(QUARANTINE_DIR, `${token}.bin`);
    const absolute = this.absolutePathFor(storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    // Mode 0600: nothing outside this process needs to read a file in doubt.
    await writeFile(absolute, bytes, { mode: 0o600 });
    return { token, storagePath };
  }

  /**
   * Moves a quarantined file into the served store.
   *
   * A rename, not a copy, so there is never a window where the same bytes exist
   * in both places. If the content is already stored, the quarantined copy is
   * simply removed — an identical logo uploaded twice costs one file.
   */
  async promote(
    quarantinePath: string,
    bytes: Buffer,
    extension: string,
  ): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storagePath = path.posix.join(
      UPLOAD_DIR,
      sha256.slice(0, 2),
      `${sha256}.${extension}`,
    );
    const absolute = this.absolutePathFor(storagePath);
    const quarantineAbsolute = this.absolutePathFor(quarantinePath);

    await mkdir(path.dirname(absolute), { recursive: true });

    const existing = await stat(absolute).catch(() => undefined);
    if (existing !== undefined) {
      await unlink(quarantineAbsolute).catch(() => undefined);
      return { sha256, storagePath, byteSize: bytes.length, deduplicated: true };
    }

    await rename(quarantineAbsolute, absolute);
    return { sha256, storagePath, byteSize: bytes.length, deduplicated: false };
  }

  /** Removes a refused file. Best effort: a leftover is caught by the sweep. */
  async discard(quarantinePath: string): Promise<void> {
    await unlink(this.absolutePathFor(quarantinePath)).catch(() => undefined);
  }

  /**
   * Clears quarantined files older than the cutoff.
   *
   * A crash between receiving and judging a file leaves it in quarantine
   * forever otherwise. Called at startup and on a timer; deliberately does not
   * touch `uploads/`, because deleting a file an asset row still references
   * would be a data loss bug rather than a cleanup.
   */
  async sweepQuarantine(olderThanMs: number, now = Date.now()): Promise<number> {
    const directory = this.absolutePathFor(QUARANTINE_DIR);
    const entries = await readdir(directory).catch(() => undefined);
    if (entries === undefined) {
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      // Only the shape this class writes; never a name from anywhere else.
      if (!/^[0-9a-f-]{36}\.bin$/u.test(entry)) {
        continue;
      }
      const absolute = this.absolutePathFor(path.posix.join(QUARANTINE_DIR, entry));
      const info = await stat(absolute).catch(() => undefined);
      if (info === undefined) {
        continue;
      }
      if (now - info.mtimeMs > olderThanMs) {
        await rm(absolute, { force: true }).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  }
}

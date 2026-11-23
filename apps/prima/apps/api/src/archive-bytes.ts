import { createHash } from 'node:crypto';
import { ARCHIVE_RULE, type ArchiveBytes } from '@prima/core';
import type { FileBackend } from './file-store';

/**
 * Where the data and file manager keeps its bytes (Fauzan, 23 Nov 2026): the same private file storage as photos and
 * proof (docs/FILE_STORAGE.md), under `archive/<unit>/<file id>.<ext>`. A file arrives in pieces and is then put
 * together; the server reads it back a few megabytes at a time and takes its size and SHA-256 from those bytes, never
 * from the browser.
 * While FILE_STORE is off there is no such store and the file manager refuses uploads with a plain message.
 */
const READ_BYTES = 4 * 1024 * 1024;

export class BackendArchiveBytes implements ArchiveBytes {
  constructor(private backend: FileBackend) {}
  async putPart(key: string, index: number, bytes: Uint8Array): Promise<void> {
    await this.backend.putBlock(key, index, Buffer.from(bytes));
  }
  async finish(key: string, parts: number, mime: string): Promise<{ size: number; sha256: string; head: Uint8Array }> {
    await this.backend.commitBlocks(key, parts, mime);
    return this.read(key);
  }
  async fingerprint(key: string): Promise<{ size: number; sha256: string }> {
    const { size, sha256 } = await this.read(key);
    return { size, sha256 };
  }
  async getRange(key: string, start: number, length: number): Promise<Uint8Array> {
    return new Uint8Array((await this.backend.getRange(key, start, length)).bytes);
  }
  /** Reads the stored file a few megabytes at a time, so a 200 MB file is never held whole in the server's memory. */
  private async read(key: string): Promise<{ size: number; sha256: string; head: Uint8Array }> {
    const hash = createHash('sha256');
    let head = new Uint8Array(0);
    let at = 0;
    let total = 1;
    while (at < total) {
      const got = await this.backend.getRange(key, at, READ_BYTES);
      if (!got.bytes.length || got.total > ARCHIVE_RULE.maxFileBytes) throw new Error('A stored file is larger than any file the app accepts.');
      if (at === 0) head = new Uint8Array(got.bytes.subarray(0, 16));
      hash.update(got.bytes);
      at += got.bytes.length;
      total = got.total;
    }
    return { size: at, sha256: hash.digest('hex'), head };
  }
}

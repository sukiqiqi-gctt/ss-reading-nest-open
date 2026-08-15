import {
  SourceObjectNotFoundError,
  sourceBytesToArrayBuffer,
  type SourceObjectStorage
} from "./source-object-storage.js";

const SOURCE_CHUNK_SIZE = 512 * 1024;

type D1ResultLike = {
  success: boolean;
  meta: { changes?: number };
};

type D1AllResultLike<T> = {
  results: T[];
};

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1AllResultLike<T>>;
  run(): Promise<D1ResultLike>;
};

export interface D1SourceDatabaseLike {
  prepare(sql: string): D1StatementLike;
}

type SourceObjectRow = {
  content_type: string | null;
  size_bytes: number;
  chunk_count: number;
};

type SourceChunkRow = {
  chunk_index: number;
  bytes: number[];
};

export class D1SourceObjectStorage implements SourceObjectStorage {
  constructor(private readonly database: D1SourceDatabaseLike) {}

  async putObject(input: {
    key: string;
    bytes: Uint8Array | ArrayBuffer | Blob;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; sizeBytes: number }> {
    const arrayBuffer = await sourceBytesToArrayBuffer(input.bytes);
    const bytes = new Uint8Array(arrayBuffer);
    const chunks = splitIntoChunks(bytes);

    await this.database
      .prepare("DELETE FROM source_object_chunks WHERE object_key = ?")
      .bind(input.key)
      .run();

    await this.database
      .prepare(
        `INSERT INTO source_objects (object_key, content_type, size_bytes, chunk_count, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(object_key) DO UPDATE SET
           content_type = excluded.content_type,
           size_bytes = excluded.size_bytes,
           chunk_count = excluded.chunk_count,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(input.key, input.contentType ?? null, bytes.byteLength, chunks.length)
      .run();

    for (const [index, chunk] of chunks.entries()) {
      await this.database
        .prepare(
          "INSERT INTO source_object_chunks (object_key, chunk_index, bytes) VALUES (?, ?, ?)"
        )
        .bind(input.key, index, chunk)
        .run();
    }

    return { key: input.key, sizeBytes: bytes.byteLength };
  }

  async getObject(key: string): Promise<{
    bytes: ArrayBuffer;
    contentType?: string;
    sizeBytes?: number;
  }> {
    const metadata = await this.database
      .prepare(
        "SELECT content_type, size_bytes, chunk_count FROM source_objects WHERE object_key = ?"
      )
      .bind(key)
      .first<SourceObjectRow>();
    if (!metadata) throw new SourceObjectNotFoundError(key);

    const result = await this.database
      .prepare(
        "SELECT chunk_index, bytes FROM source_object_chunks WHERE object_key = ? ORDER BY chunk_index"
      )
      .bind(key)
      .all<SourceChunkRow>();

    if (result.results.length !== metadata.chunk_count) {
      throw new SourceObjectNotFoundError(key);
    }

    const bytes = new Uint8Array(metadata.size_bytes);
    let offset = 0;
    for (const row of result.results) {
      const chunk = Uint8Array.from(row.bytes);
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    if (offset !== metadata.size_bytes) {
      throw new SourceObjectNotFoundError(key);
    }

    return {
      bytes: bytes.buffer,
      ...(metadata.content_type ? { contentType: metadata.content_type } : {}),
      sizeBytes: metadata.size_bytes
    };
  }

  async headObject(key: string): Promise<{
    exists: boolean;
    contentType?: string;
    sizeBytes?: number;
  }> {
    const row = await this.database
      .prepare("SELECT content_type, size_bytes FROM source_objects WHERE object_key = ?")
      .bind(key)
      .first<{ content_type: string | null; size_bytes: number }>();
    if (!row) return { exists: false };
    return {
      exists: true,
      ...(row.content_type ? { contentType: row.content_type } : {}),
      sizeBytes: row.size_bytes
    };
  }

  async deleteObject(key: string): Promise<{ deleted: boolean }> {
    await this.database
      .prepare("DELETE FROM source_object_chunks WHERE object_key = ?")
      .bind(key)
      .run();
    const result = await this.database
      .prepare("DELETE FROM source_objects WHERE object_key = ?")
      .bind(key)
      .run();
    return { deleted: (result.meta.changes ?? 0) > 0 };
  }
}

function splitIntoChunks(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength === 0) return [new Uint8Array()];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += SOURCE_CHUNK_SIZE) {
    chunks.push(bytes.slice(offset, Math.min(offset + SOURCE_CHUNK_SIZE, bytes.byteLength)));
  }
  return chunks;
}

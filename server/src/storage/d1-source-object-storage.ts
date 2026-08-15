import {
  SourceObjectNotFoundError,
  sourceBytesToArrayBuffer,
  type SourceObjectStorage
} from "./source-object-storage.js";

type D1ResultLike = {
  success: boolean;
  meta: { changes?: number };
};

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
};

export interface D1SourceDatabaseLike {
  prepare(sql: string): D1StatementLike;
}

type SourceObjectRow = {
  bytes: ArrayBuffer;
  content_type: string | null;
  size_bytes: number;
};

export class D1SourceObjectStorage implements SourceObjectStorage {
  constructor(private readonly database: D1SourceDatabaseLike) {}

  async putObject(input: {
    key: string;
    bytes: Uint8Array | ArrayBuffer | Blob;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; sizeBytes: number }> {
    const bytes = await sourceBytesToArrayBuffer(input.bytes);
    const sizeBytes = bytes.byteLength;
    await this.database
      .prepare(
        `INSERT INTO source_objects (object_key, bytes, content_type, size_bytes, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(object_key) DO UPDATE SET
           bytes = excluded.bytes,
           content_type = excluded.content_type,
           size_bytes = excluded.size_bytes,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(input.key, bytes, input.contentType ?? null, sizeBytes)
      .run();
    return { key: input.key, sizeBytes };
  }

  async getObject(key: string): Promise<{
    bytes: ArrayBuffer;
    contentType?: string;
    sizeBytes?: number;
  }> {
    const row = await this.database
      .prepare("SELECT bytes, content_type, size_bytes FROM source_objects WHERE object_key = ?")
      .bind(key)
      .first<SourceObjectRow>();
    if (!row) throw new SourceObjectNotFoundError(key);
    return {
      bytes: copyArrayBuffer(row.bytes),
      ...(row.content_type ? { contentType: row.content_type } : {}),
      sizeBytes: row.size_bytes
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
    const result = await this.database
      .prepare("DELETE FROM source_objects WHERE object_key = ?")
      .bind(key)
      .run();
    return { deleted: (result.meta.changes ?? 0) > 0 };
  }
}

function copyArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0);
}

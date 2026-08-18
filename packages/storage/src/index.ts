import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/**
 * S3-compatible object storage client (MinIO in staging, S3 in production).
 * Used to store imported file content (PDFs, spreadsheets, etc.) as managed
 * snapshots. Objects are addressed by a deterministic key derived from the
 * artifact ID and version.
 */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
  }

  get defaultBucket(): string {
    return this.bucket;
  }

  async createBucketIfNotExists(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }

  async putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name: string }).name === "NoSuchKey"
      ) {
        return null;
      }
      // Also handle 404 from MinIO
      if (
        typeof err === "object" &&
        err !== null &&
        "$metadata" in err &&
        (err as { $metadata: { httpStatusCode: number } }).$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }
}

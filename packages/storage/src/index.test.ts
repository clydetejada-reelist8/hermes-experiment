import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ObjectStorage } from "./index.js";

const config = {
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9000",
  bucket: process.env.OBJECT_STORAGE_BUCKET ?? "hermes-staging",
  accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "hermes",
  secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "hermes-staging",
};

async function ensureBucket(storage: ObjectStorage): Promise<void> {
  try {
    await storage.createBucketIfNotExists(config.bucket);
  } catch {
    // bucket may already exist
  }
}

describe("ObjectStorage", () => {
  it("puts and gets an object", async () => {
    const storage = new ObjectStorage(config);
    await ensureBucket(storage);
    const key = `test/${randomUUID()}.txt`;
    const body = Buffer.from("hello hermes");
    await storage.putObject(config.bucket, key, body, "text/plain");
    const retrieved = await storage.getObject(config.bucket, key);
    expect(retrieved.toString()).toBe("hello hermes");
  });

  it("returns undefined for a missing object", async () => {
    const storage = new ObjectStorage(config);
    await ensureBucket(storage);
    const result = await storage.getObject(config.bucket, `missing/${randomUUID()}.txt`);
    expect(result).toBeNull();
  });
});

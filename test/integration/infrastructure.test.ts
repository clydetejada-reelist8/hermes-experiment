import { describe, expect, it } from "vitest";
import { db } from "@hermes/db";

describe("staging infrastructure", () => {
  it("connects to PostgreSQL and has the pgvector extension", async () => {
    const rows = await db.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.extname).toBe("vector");
  });
});

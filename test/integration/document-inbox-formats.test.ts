import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
// @ts-expect-error pngjs has no local type dependency in the integration fixture.
import { PNG } from "pngjs";
import { db } from "@hermes/db";
import { createSubmission, ingestImportedFile } from "@hermes/artifacts";
import { hybridRetrieve } from "@hermes/knowledge";
import {
  DeterministicEmbeddingFunction,
  processDocumentArtifact,
} from "../../apps/worker/src/processing.js";
import { createEmployee, grantCapability } from "../fixtures/db-helpers.js";

class MemoryStorage {
  private readonly objects = new Map<string, Buffer>();
  async putObject(_bucket: string, key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
  async getObject(_bucket: string, key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
}

function makePdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 32} >>\nstream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function makeDocx(identifier: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Handbook Section</w:t></w:r></w:p><w:p><w:r><w:t>${identifier}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeXlsx(identifier: string): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Reference", "Amount"],
      [identifier, 42],
    ]),
    "Revenue Forecast",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function makePptx(identifier: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:sp><p:txBody><a:p><a:r><a:t>Strategy</a:t></a:r></a:p><a:p><a:r><a:t>${identifier}</a:t></a:r></a:p></p:txBody></p:sp></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeImage(): Buffer {
  const glyphs: Record<string, string[]> = {
    I: ["111", "010", "010", "010", "010", "010", "111"],
    D: ["110", "101", "101", "101", "101", "101", "110"],
    4: ["101", "101", "101", "111", "001", "001", "001"],
    2: ["110", "001", "001", "010", "100", "100", "111"],
  };
  const label = "ID42";
  const scale = 12;
  const png = new PNG({ width: label.length * 5 * scale, height: 7 * scale });
  png.data.fill(255);
  for (let charIndex = 0; charIndex < label.length; charIndex += 1) {
    const glyph = glyphs[label[charIndex]!]!;
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row]!.length; col += 1) {
        if (glyph[row]![col] !== "1") continue;
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            const px = (charIndex * 5 + col) * scale + x;
            const py = row * scale + y;
            const offset = (py * png.width + px) * 4;
            png.data[offset] = 0;
            png.data[offset + 1] = 0;
            png.data[offset + 2] = 0;
          }
        }
      }
    }
  }
  return PNG.sync.write(png);
}

describe("Knowledge Inbox document formats", () => {
  it.each([
    [
      "PDF",
      "Employee Handbook.pdf",
      "application/pdf",
      (id: string) => Promise.resolve(makePdf(id)),
      "Employee Handbook.pdf — page 1",
    ],
    [
      "DOCX",
      "Handbook.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      makeDocx,
      "Handbook.docx — section Handbook Section",
    ],
    [
      "XLSX",
      "Q3 Forecast.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      makeXlsx,
      "Q3 Forecast.xlsx — Revenue Forecast — rows 2-2",
    ],
    [
      "PPTX",
      "Sales Strategy.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      makePptx,
      "Sales Strategy.pptx — slide 1",
    ],
  ])(
    "uploads, indexes, cites, and filters %s",
    async (_format, filename, mimeType, makeFixture, expectedLocator) => {
      const identifier = `RL8-FMT-${randomUUID()}`;
      const owner = await createEmployee();
      const outsider = await createEmployee();
      await grantCapability(owner.id, "KNOWLEDGE_READ_PERSONAL");
      await grantCapability(outsider.id, "KNOWLEDGE_READ_PERSONAL");
      const storage = new MemoryStorage();
      const content = await makeFixture(identifier);
      const imported = await ingestImportedFile({
        storage: storage as never,
        bucket: "test",
        submittedByEmployeeId: owner.id,
        originalFilename: filename,
        mimeType,
        content,
        sourceSystem: "TEST_DOCUMENT_INBOX",
        externalId: `format-${randomUUID()}`,
      });
      await createSubmission({
        artifactId: imported.artifact.id,
        submittedByEmployeeId: owner.id,
        ownerEmployeeId: owner.id,
        scope: "PERSONAL",
        knowledgeStatus: "PERSONAL_CONTEXT",
      });
      const processed = await processDocumentArtifact({
        artifactVersionId: imported.version.id,
        content,
        mimeType,
        filename,
        embeddingFn: new DeterministicEmbeddingFunction(),
      });
      await db.artifactVersion.update({
        where: { id: imported.version.id },
        data: { extractionStatus: "READY", extractedAt: new Date() },
      });
      expect(processed.chunks.length).toBeGreaterThan(0);
      expect(imported.version.originalObjectKey).toBeTruthy();
      expect(await storage.getObject("test", imported.version.originalObjectKey!)).toEqual(content);
      expect(processed.chunks.some((chunk) => chunk.sourceLocator === expectedLocator)).toBe(true);

      const embedding = await new DeterministicEmbeddingFunction().embed(identifier);
      const ownerResults = await hybridRetrieve({
        employeeId: owner.id,
        query: identifier,
        queryEmbedding: embedding,
        limit: 10,
        embeddingFn: new DeterministicEmbeddingFunction(),
      });
      expect(ownerResults.some((result) => result.text.includes(identifier))).toBe(true);
      expect(ownerResults.find((result) => result.text.includes(identifier))?.sourceLocator).toBe(
        expectedLocator,
      );

      const outsiderResults = await hybridRetrieve({
        employeeId: outsider.id,
        query: identifier,
        queryEmbedding: embedding,
        limit: 10,
        embeddingFn: new DeterministicEmbeddingFunction(),
      });
      expect(outsiderResults.every((result) => !result.text.includes(identifier))).toBe(true);
    },
    30000,
  );

  it("uploads, OCRs, cites, and permission-filters a screenshot", async () => {
    const owner = await createEmployee();
    const outsider = await createEmployee();
    await grantCapability(owner.id, "KNOWLEDGE_READ_PERSONAL");
    await grantCapability(outsider.id, "KNOWLEDGE_READ_PERSONAL");
    const storage = new MemoryStorage();
    const content = makeImage();
    const imported = await ingestImportedFile({
      storage: storage as never,
      bucket: "test",
      submittedByEmployeeId: owner.id,
      originalFilename: "screenshot.png",
      mimeType: "image/png",
      content,
      sourceSystem: "TEST_DOCUMENT_INBOX",
      externalId: `image-${randomUUID()}`,
    });
    await createSubmission({
      artifactId: imported.artifact.id,
      submittedByEmployeeId: owner.id,
      ownerEmployeeId: owner.id,
      scope: "PERSONAL",
      knowledgeStatus: "PERSONAL_CONTEXT",
    });
    const processed = await processDocumentArtifact({
      artifactVersionId: imported.version.id,
      content,
      mimeType: "image/png",
      filename: "screenshot.png",
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    const query = processed.chunks[0]!.text.split(/\s+/)[0]!;
    const embedding = await new DeterministicEmbeddingFunction().embed(query);
    const ownerResults = await hybridRetrieve({
      employeeId: owner.id,
      query,
      queryEmbedding: embedding,
      limit: 10,
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    expect(ownerResults.some((result) => result.sourceLocator === "screenshot.png — OCR")).toBe(
      true,
    );
    const outsiderResults = await hybridRetrieve({
      employeeId: outsider.id,
      query,
      queryEmbedding: embedding,
      limit: 10,
      embeddingFn: new DeterministicEmbeddingFunction(),
    });
    expect(outsiderResults.every((result) => result.sourceLocator !== "screenshot.png — OCR")).toBe(
      true,
    );
  }, 120000);
});

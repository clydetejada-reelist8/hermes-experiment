import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { PNG } from "pngjs";
import { deflateSync } from "node:zlib";
import { extractDocument, extractText } from "./extract.js";
import { DEFAULT_DOCUMENT_PROCESSING_LIMITS } from "./limits.js";

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

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly Plan</w:t></w:r></w:p><w:p><w:r><w:t>PROJECT-ABC-123 is approved.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Revenue</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:sp><p:txBody><a:p><a:r><a:t>Sales Strategy</a:t></a:r></a:p><a:p><a:r><a:t>TICKET-42 is ready.</a:t></a:r></a:p></p:txBody></p:sp></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Discuss pricing.</a:t></a:r></a:p></p:notes>`,
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

function makeScannedPdf(image: Buffer, mixed = false): Buffer {
  const png = PNG.sync.read(image);
  const rgb = Buffer.alloc(png.width * png.height * 3);
  for (let index = 0; index < png.width * png.height; index += 1) {
    rgb[index * 3] = png.data[index * 4]!;
    rgb[index * 3 + 1] = png.data[index * 4 + 1]!;
    rgb[index * 3 + 2] = png.data[index * 4 + 2]!;
  }
  const compressed = deflateSync(rgb).toString("latin1");
  const imageObject = `<< /Type /XObject /Subtype /Image /Width ${png.width} /Height ${png.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n${compressed}\nendstream`;
  const imageContent = `q\n${png.width} 0 0 ${png.height} 0 0 cm\n/Im1 Do\nQ`;
  const imageContentObject = `<< /Length ${imageContent.length} >>\nstream\n${imageContent}\nendstream`;
  const objects = mixed
    ? [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Length 47 >>\nstream\nBT /F1 18 Tf 72 720 Td (Text page) Tj ET\nendstream",
        imageContentObject,
        imageObject,
      ]
    : [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>",
        "<<>>",
        imageObject,
        imageContentObject,
      ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("document extraction", () => {
  it("extracts PDF page provenance and exact identifiers", async () => {
    const result = await extractDocument(
      makePdf("PROJECT-ABC-123"),
      "application/pdf",
      "Employee Handbook.pdf",
    );
    expect(result.segments[0]).toMatchObject({
      text: "PROJECT-ABC-123",
      pageNumber: 1,
      sourceLocator: "Employee Handbook.pdf — page 1",
    });
  });

  it("falls back to local OCR for a fully scanned PDF", async () => {
    const result = await extractDocument(
      makeScannedPdf(makeImage()),
      "application/pdf",
      "Scanned.pdf",
    );
    expect(result.segments[0]!.sourceLocator).toBe("Scanned.pdf — page 1");
    expect(result.segments[0]!.text.trim()).toBeTruthy();
  }, 120000);

  it("combines text and OCR pages in a mixed PDF", async () => {
    const result = await extractDocument(
      makeScannedPdf(makeImage(), true),
      "application/pdf",
      "Mixed.pdf",
    );
    expect(result.segments.some((segment) => segment.text.includes("Text page"))).toBe(true);
    expect(result.segments.some((segment) => segment.sourceLocator === "Mixed.pdf — page 2")).toBe(
      true,
    );
  }, 120000);

  it("rejects an unreadable scanned PDF after OCR", async () => {
    const blank = new PNG({ width: 120, height: 84 });
    blank.data.fill(255);
    await expect(
      extractDocument(makeScannedPdf(PNG.sync.write(blank)), "application/pdf", "Blank.pdf"),
    ).rejects.toThrow("document_no_readable_content");
  }, 120000);

  it("extracts DOCX headings, paragraphs, and table rows", async () => {
    const result = await extractDocument(
      await makeDocx(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Plan.docx",
    );
    const text = result.segments.map((segment) => segment.text).join(" ");
    expect(text).toContain("Quarterly Plan");
    expect(text).toContain("PROJECT-ABC-123");
    expect(text).toContain("Revenue");
  });

  it("extracts XLSX sheet names, headers, rows, and identifiers", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Ticket", "Amount"],
        ["TICKET-42", 100],
      ]),
      "Revenue Forecast",
    );
    const result = await extractDocument(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Q3 Forecast.xlsx",
    );
    expect(result.segments[0]).toMatchObject({ sheetName: "Revenue Forecast" });
    expect(result.segments[0]!.text).toContain("TICKET-42");
    expect(result.segments[0]!.sourceLocator).toContain("rows 2-2");
  });

  it("extracts PPTX slide text and speaker notes", async () => {
    const result = await extractDocument(
      await makePptx(),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Sales Strategy.pptx",
    );
    expect(result.segments[0]!.sourceLocator).toBe("Sales Strategy.pptx — slide 1");
    expect(result.segments[0]!.text).toContain("Sales Strategy");
    expect(result.segments[0]!.text).toContain("Discuss pricing.");
  });

  it("extracts readable screenshot text locally with OCR", async () => {
    const result = await extractDocument(makeImage(), "image/png", "screenshot.png");
    expect(result.segments[0]!.sourceLocator).toBe("screenshot.png — OCR");
    expect(result.segments[0]!.text.trim().length).toBeGreaterThan(0);
  }, 120000);

  it("enforces extracted text, page, and filename safety limits", async () => {
    await expect(
      extractDocument(makePdf("too large"), "application/pdf", "../../secret.pdf", {
        ...DEFAULT_DOCUMENT_PROCESSING_LIMITS,
        maxExtractedTextBytes: 1,
      }),
    ).rejects.toThrow("document_limit_extracted_text");
    const result = await extractDocument(makePdf("safe"), "application/pdf", "../../secret.pdf");
    expect(result.segments[0]!.sourceLocator).toBe(".._.._secret.pdf — page 1");
    await expect(extractDocument(makePdf("safe"), "image/png", "file.pdf")).rejects.toThrow(
      "document_mime_extension_mismatch",
    );
    await expect(extractDocument(makePdf("safe"), "application/pdf", "file.txt")).rejects.toThrow(
      "document_mime_extension_mismatch",
    );
    await expect(extractDocument(Buffer.from("Revenue"), "text/plain", "file.pdf")).rejects.toThrow(
      "document_mime_extension_mismatch",
    );
  });

  it("fails malformed ZIP-based office files safely", async () => {
    await expect(
      extractDocument(
        Buffer.from("PK\u0003\u0004garbage"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "bad.docx",
      ),
    ).rejects.toThrow("document_malformed_docx");
    const zip = new JSZip();
    zip.file("word/document.xml", "x".repeat(1024));
    const expanded = await zip.generateAsync({ type: "nodebuffer" });
    await expect(
      extractDocument(
        expanded,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "expanded.docx",
        {
          ...DEFAULT_DOCUMENT_PROCESSING_LIMITS,
          maxZipExpansionBytes: 10,
        },
      ),
    ).rejects.toThrow("document_limit_zip_expansion");
  });

  it("enforces PDF page limits", async () => {
    await expect(
      extractDocument(makePdf("one"), "application/pdf", "one.pdf", {
        ...DEFAULT_DOCUMENT_PROCESSING_LIMITS,
        maxPdfPages: 0,
      }),
    ).rejects.toThrow("document_limit_pdf_pages");
  });

  it("rejects malformed and unsupported files without pretending extraction succeeded", async () => {
    await expect(
      extractDocument(Buffer.from("not a pdf"), "application/pdf", "broken.pdf"),
    ).rejects.toThrow("document_malformed_pdf");
    await expect(
      extractDocument(Buffer.from("data"), "application/octet-stream", "file.bin"),
    ).rejects.toThrow("unsupported_document_format");
    expect(extractText(Buffer.from("Revenue"), "text/plain", "notes.txt")).toBe("Revenue");
  });
});

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { createWorker } from "tesseract.js";
import { createCanvas } from "@napi-rs/canvas";
import { DEFAULT_DOCUMENT_PROCESSING_LIMITS, type DocumentProcessingLimits } from "./limits.js";

export interface ExtractedSegment {
  text: string;
  pageNumber?: number;
  sheetName?: string;
  sourceLocator: string;
}
export interface ExtractedDocument {
  segments: ExtractedSegment[];
  metadata: Record<string, unknown>;
}

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
]);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export function extractText(content: Buffer, mimeType: string, filename: string): string {
  const normalizedMime = normalizeMime(mimeType);
  const supported =
    TEXT_MIME_TYPES.has(normalizedMime) ||
    ["txt", "md", "csv", "json", "xml"].includes(extensionOf(filename));
  if (!supported) throw new Error("text_extraction_not_implemented");
  const text = content.toString("utf8");
  if (text.includes("\u0000")) throw new Error("text_extraction_invalid_content");
  return text;
}

export async function extractDocument(
  content: Buffer,
  mimeType: string,
  filename: string,
  limits: DocumentProcessingLimits = DEFAULT_DOCUMENT_PROCESSING_LIMITS,
): Promise<ExtractedDocument> {
  const mime = normalizeMime(mimeType);
  const extension = extensionOf(filename);
  validateFormatAgreement(content, mime, extension);
  const citationFilename = safeFilename(filename);
  if (mime === "application/pdf" || extension === "pdf")
    return extractPdf(content, citationFilename, limits);
  if (mime.includes("wordprocessingml.document") || extension === "docx")
    return extractDocx(content, citationFilename, limits);
  if (mime.includes("spreadsheetml.sheet") || extension === "xlsx")
    return extractXlsx(content, citationFilename, limits);
  if (mime.includes("presentationml.presentation") || extension === "pptx")
    return extractPptx(content, citationFilename, limits);
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(extension))
    return extractImage(content, citationFilename, limits);
  if (TEXT_MIME_TYPES.has(mime) || ["txt", "md", "csv", "json", "xml"].includes(extension)) {
    return {
      segments: [
        { text: extractText(content, mime, citationFilename), sourceLocator: citationFilename },
      ],
      metadata: { format: "text" },
    };
  }
  throw new Error("unsupported_document_format");
}

async function extractPdf(
  content: Buffer,
  filename: string,
  limits: DocumentProcessingLimits,
): Promise<ExtractedDocument> {
  let document: Awaited<ReturnType<typeof pdfjsLib.getDocument>>["promise"] extends Promise<infer T>
    ? T
    : never;
  try {
    document = await pdfjsLib.getDocument({ data: new Uint8Array(content), useWorkerFetch: false })
      .promise;
  } catch {
    throw new Error("document_malformed_pdf");
  }
  if (document.numPages > limits.maxPdfPages) throw new Error("document_limit_pdf_pages");
  const segments: ExtractedSegment[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 2) {
      segments.push({ text, pageNumber, sourceLocator: `${filename} — page ${pageNumber}` });
      continue;
    }
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvas: canvas as never,
      canvasContext: canvas.getContext("2d") as never,
      viewport,
    }).promise;

    const ocrText = await ocrBuffer(canvas.toBuffer("image/png"), limits.ocrTimeoutMs);
    if (ocrText)
      segments.push({
        text: ocrText,
        pageNumber,
        sourceLocator: `${filename} — page ${pageNumber}`,
      });
  }
  assertExtractedSize(segments, limits.maxExtractedTextBytes);
  if (segments.length === 0) throw new Error("document_no_readable_content");
  return { segments, metadata: { format: "pdf", pages: document.numPages } };
}

async function extractDocx(
  content: Buffer,
  filename: string,
  limits: DocumentProcessingLimits,
): Promise<ExtractedDocument> {
  if (content.length > limits.maxDocxBytes) throw new Error("document_limit_docx_bytes");
  await loadZipWithinLimit(content, "document_malformed_docx", limits.maxZipExpansionBytes);
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: content })).value;
  } catch {
    throw new Error("document_malformed_docx");
  }
  const segments: ExtractedSegment[] = [];
  const blockPattern = /<(h[1-6]|p|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let section = "Document";
  let tableIndex = 0;
  while ((match = blockPattern.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase();
    const text = decodeHtml(match[2]!).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (tag.startsWith("h")) section = text;
    segments.push({
      text: tag === "tr" ? `Table row: ${text}` : text,
      sourceLocator:
        tag === "tr" ? `${filename} — table ${++tableIndex}` : `${filename} — section ${section}`,
    });
  }
  assertExtractedSize(segments, limits.maxExtractedTextBytes);
  if (segments.length === 0) throw new Error("document_no_readable_content");
  return { segments, metadata: { format: "docx", sections: segments.length } };
}

async function extractXlsx(
  content: Buffer,
  filename: string,
  limits: DocumentProcessingLimits,
): Promise<ExtractedDocument> {
  if (content.length > limits.maxUploadBytes) throw new Error("document_limit_xlsx_bytes");
  await loadZipWithinLimit(content, "document_malformed_xlsx", limits.maxZipExpansionBytes);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(content, { type: "buffer", cellDates: true, raw: false });
  } catch {
    throw new Error("document_malformed_xlsx");
  }
  if (workbook.SheetNames.length > limits.maxXlsxSheets)
    throw new Error("document_limit_xlsx_sheets");
  const segments: ExtractedSegment[] = [];
  let cellCount = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    if (rows.length > limits.maxXlsxRows) throw new Error("document_limit_xlsx_rows");
    cellCount += rows.reduce((total, row) => total + row.length, 0);
    if (cellCount > limits.maxXlsxCells) throw new Error("document_limit_xlsx_cells");
    const headers = (rows[0] ?? []).map((value, index) => String(value || `Column ${index + 1}`));
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const values = row
        .map((value, index) => `${headers[index] ?? `Column ${index + 1}`}: ${String(value)}`)
        .filter((value) => !value.endsWith(": "));
      if (values.length === 0) continue;
      const excelRow = rowIndex + 1;
      segments.push({
        text: `Sheet: ${sheetName}\nRow ${excelRow}: ${values.join(" | ")}`,
        sheetName,
        sourceLocator: `${filename} — ${sheetName} — rows ${excelRow}-${excelRow}`,
      });
    }
    if (rows.length > 0 && segments.every((segment) => segment.sheetName !== sheetName))
      segments.push({
        text: `Sheet: ${sheetName}\n${headers.join(" | ")}`,
        sheetName,
        sourceLocator: `${filename} — ${sheetName}`,
      });
  }
  assertExtractedSize(segments, limits.maxExtractedTextBytes);
  if (segments.length === 0) throw new Error("document_no_readable_content");
  return {
    segments,
    metadata: { format: "xlsx", workbook: filename, sheets: workbook.SheetNames },
  };
}

async function extractPptx(
  content: Buffer,
  filename: string,
  limits: DocumentProcessingLimits,
): Promise<ExtractedDocument> {
  const zip = await loadZipWithinLimit(
    content,
    "document_malformed_pptx",
    limits.maxZipExpansionBytes,
  );
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]));
  if (slideNames.length > limits.maxPptxSlides) throw new Error("document_limit_pptx_slides");
  const segments: ExtractedSegment[] = [];
  for (let index = 0; index < slideNames.length; index += 1) {
    const slideNumber = index + 1;
    const text = collectXmlText(parser.parse(await zip.files[slideNames[index]!]!.async("string")))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const notesFile = zip.files[`ppt/notesSlides/notesSlide${slideNumber}.xml`];
    const notes = notesFile
      ? collectXmlText(parser.parse(await notesFile.async("string")))
          .join(" ")
          .trim()
      : "";
    const combined = [text, notes ? `Speaker notes: ${notes}` : ""].filter(Boolean).join("\n");
    if (combined)
      segments.push({ text: combined, sourceLocator: `${filename} — slide ${slideNumber}` });
  }
  assertExtractedSize(segments, limits.maxExtractedTextBytes);
  if (segments.length === 0) throw new Error("document_no_readable_content");
  return { segments, metadata: { format: "pptx", slides: slideNames.length } };
}

async function extractImage(
  content: Buffer,
  filename: string,
  limits: DocumentProcessingLimits,
): Promise<ExtractedDocument> {
  const text = await ocrBuffer(content, limits.ocrTimeoutMs);
  if (!text) throw new Error("document_no_readable_content");
  return {
    segments: [{ text, sourceLocator: `${filename} — OCR` }],
    metadata: { format: "image", ocr: "tesseract-eng" },
  };
}

async function ocrBuffer(content: Buffer, timeoutMs: number): Promise<string> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker("eng", 1, {
      cachePath: process.env.TESSERACT_CACHE_PATH ?? "/tmp/hermes-tesseract",
    });
    const result = await withTimeout(worker.recognize(content), timeoutMs, "document_ocr_timeout");
    return result.data.text.replace(/\s+/g, " ").trim();
  } catch (error) {
    if (error instanceof Error && error.message === "document_ocr_timeout") throw error;
    throw new Error("image_ocr_failed");
  } finally {
    await worker?.terminate();
  }
}

async function loadZipWithinLimit(
  content: Buffer,
  malformedError: string,
  maxExpansionBytes: number,
): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(content);
  } catch {
    throw new Error(malformedError);
  }
  const estimatedExpansion = Object.values(zip.files).reduce(
    (total, file) =>
      total +
      ((file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
    0,
  );
  if (estimatedExpansion > maxExpansionBytes) throw new Error("document_limit_zip_expansion");
  return zip;
}

function assertExtractedSize(segments: ExtractedSegment[], maxBytes: number): void {
  if (Buffer.byteLength(segments.map((segment) => segment.text).join("\n"), "utf8") > maxBytes)
    throw new Error("document_limit_extracted_text");
}
function safeFilename(filename: string): string {
  return filename.replace(/[\\/]/g, "_").split("\0").join("_");
}
function normalizeMime(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}
function extensionOf(filename: string): string {
  const basename = filename.toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot + 1) : "";
}
function collectXmlText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectXmlText);
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key.startsWith("@_") ? [] : collectXmlText(child),
  );
}
function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
function formatFromMime(mime: string): string | undefined {
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml.document")) return "docx";
  if (mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (mime.includes("presentationml.presentation")) return "pptx";
  if (mime.startsWith("image/")) return "image";
  if (TEXT_MIME_TYPES.has(mime)) return "text";
  return undefined;
}
function formatFromExtension(extension: string): string | undefined {
  if (["pdf", "docx", "xlsx", "pptx"].includes(extension)) return extension;
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (["txt", "md", "csv", "json", "xml"].includes(extension)) return "text";
  return undefined;
}
function looksLikeImage(content: Buffer): boolean {
  return (
    content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    content.subarray(0, 2).equals(Buffer.from([255, 216])) ||
    content.subarray(0, 4).equals(Buffer.from("RIFF"))
  );
}
function validateFormatAgreement(content: Buffer, mime: string, extension: string): void {
  const mimeFormat = formatFromMime(mime);
  const extensionFormat = formatFromExtension(extension);
  if (mimeFormat && extension && !extensionFormat)
    throw new Error("document_mime_extension_mismatch");
  if (mimeFormat && extensionFormat && mimeFormat !== extensionFormat)
    throw new Error("document_mime_extension_mismatch");
  const format = mimeFormat ?? extensionFormat;
  if (format === "pdf" && !content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(
      mimeFormat && extensionFormat ? "document_malformed_pdf" : "document_mime_extension_mismatch",
    );
  }
  if (
    ["docx", "xlsx", "pptx"].includes(format ?? "") &&
    !content.subarray(0, 2).equals(Buffer.from("PK"))
  ) {
    throw new Error(
      mimeFormat && extensionFormat
        ? `document_malformed_${format}`
        : "document_mime_extension_mismatch",
    );
  }
  if (format === "image" && !looksLikeImage(content)) {
    throw new Error(
      mimeFormat && extensionFormat
        ? "document_malformed_image"
        : "document_mime_extension_mismatch",
    );
  }
}
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

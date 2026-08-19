export interface DocumentProcessingLimits {
  maxUploadBytes: number;
  maxExtractedTextBytes: number;
  maxPdfPages: number;
  maxDocxBytes: number;
  maxXlsxSheets: number;
  maxXlsxRows: number;
  maxXlsxCells: number;
  maxPptxSlides: number;
  maxZipExpansionBytes: number;
  extractionTimeoutMs: number;
  ocrTimeoutMs: number;
  workerMaxRetries: number;
}

export const DEFAULT_DOCUMENT_PROCESSING_LIMITS: DocumentProcessingLimits = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxExtractedTextBytes: 5 * 1024 * 1024,
  maxPdfPages: 200,
  maxDocxBytes: 25 * 1024 * 1024,
  maxXlsxSheets: 50,
  maxXlsxRows: 100_000,
  maxXlsxCells: 1_000_000,
  maxPptxSlides: 200,
  maxZipExpansionBytes: 100 * 1024 * 1024,
  extractionTimeoutMs: 120_000,
  ocrTimeoutMs: 60_000,
  workerMaxRetries: 3,
};

export function documentProcessingLimitsFromEnv(env: NodeJS.ProcessEnv): DocumentProcessingLimits {
  const number = (name: string, fallback: number): number => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  return {
    maxUploadBytes: number("UPLOAD_MAX_BYTES", DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxUploadBytes),
    maxExtractedTextBytes: number(
      "DOCUMENT_MAX_EXTRACTED_TEXT_BYTES",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxExtractedTextBytes,
    ),
    maxPdfPages: number("DOCUMENT_MAX_PDF_PAGES", DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxPdfPages),
    maxDocxBytes: number(
      "DOCUMENT_MAX_DOCX_BYTES",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxDocxBytes,
    ),
    maxXlsxSheets: number(
      "DOCUMENT_MAX_XLSX_SHEETS",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxXlsxSheets,
    ),
    maxXlsxRows: number("DOCUMENT_MAX_XLSX_ROWS", DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxXlsxRows),
    maxXlsxCells: number(
      "DOCUMENT_MAX_XLSX_CELLS",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxXlsxCells,
    ),
    maxPptxSlides: number(
      "DOCUMENT_MAX_PPTX_SLIDES",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxPptxSlides,
    ),
    maxZipExpansionBytes: number(
      "DOCUMENT_MAX_ZIP_EXPANSION_BYTES",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.maxZipExpansionBytes,
    ),
    extractionTimeoutMs: number(
      "DOCUMENT_EXTRACTION_TIMEOUT_MS",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.extractionTimeoutMs,
    ),
    ocrTimeoutMs: number(
      "DOCUMENT_OCR_TIMEOUT_MS",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.ocrTimeoutMs,
    ),
    workerMaxRetries: number(
      "DOCUMENT_WORKER_MAX_RETRIES",
      DEFAULT_DOCUMENT_PROCESSING_LIMITS.workerMaxRetries,
    ),
  };
}

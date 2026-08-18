const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
]);

export function extractText(content: Buffer, mimeType: string, filename: string): string {
  const normalizedMime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const supported =
    TEXT_MIME_TYPES.has(normalizedMime) || ["txt", "md", "csv", "json", "xml"].includes(extension);
  if (!supported) throw new Error("text_extraction_not_implemented");
  const text = content.toString("utf8");
  if (text.includes("\u0000")) throw new Error("text_extraction_invalid_content");
  return text;
}

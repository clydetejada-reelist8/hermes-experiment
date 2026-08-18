export { processTextArtifact } from "./processing.js";
export type { ProcessArtifactInput } from "./processing.js";

// Queue/bootstrap wiring is intentionally separate from processors so tests can
// exercise ingestion deterministically without Redis credentials.

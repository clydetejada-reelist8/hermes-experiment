export type ErrorCategory = "client_error" | "server_error" | "security_error" | "provider_error";

export interface HermesErrorOptions {
  category: ErrorCategory;
  statusCode?: number;
  details?: Record<string, unknown>;
  cause?: Error;
}

/**
 * HermesError — structured error with deterministic error codes.
 *
 * Every error in the system uses a HermesError with:
 *   - A stable error code (e.g., "VALIDATION_ERROR", "POLICY_DENIED")
 *   - A category (client_error, server_error, security_error, provider_error)
 *   - An HTTP status code
 *   - Optional structured details
 */
export class HermesError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  override readonly cause?: Error;

  constructor(code: string, message: string, options: HermesErrorOptions) {
    super(message);
    this.name = "HermesError";
    this.code = code;
    this.category = options.category;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
    this.cause = options.cause;
  }

  toJSON(): {
    code: string;
    message: string;
    category: ErrorCategory;
    statusCode: number;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Common error codes used throughout the system.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  POLICY_DENIED: "POLICY_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  SECURITY_VIOLATION: "SECURITY_VIOLATION",
  AMBIGUOUS_OUTCOME: "AMBIGUOUS_OUTCOME",
} as const;

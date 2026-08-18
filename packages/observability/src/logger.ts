export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
  correlationId?: string;
  requestId?: string;
}

/**
 * Structured logger that emits JSON to stdout. Every log entry includes
 * a timestamp, level, event name, and optional structured fields.
 *
 * Correlation and request IDs can be set for tracing across services.
 */
class StructuredLogger {
  private correlationId: string | undefined;
  private requestId: string | undefined;

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  clearCorrelationId(): void {
    this.correlationId = undefined;
  }

  setRequestId(id: string): void {
    this.requestId = id;
  }

  clearRequestId(): void {
    this.requestId = undefined;
  }

  debug(event: string, fields: Record<string, unknown>): void {
    this.emit("debug", event, fields);
  }

  info(event: string, fields: Record<string, unknown>): void {
    this.emit("info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown>): void {
    this.emit("warn", event, fields);
  }

  error(event: string, fields: Record<string, unknown>): void {
    this.emit("error", event, fields);
  }

  private emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      fields,
    };
    if (this.correlationId) entry.correlationId = this.correlationId;
    if (this.requestId) entry.requestId = this.requestId;
    console.log(JSON.stringify(entry));
  }
}

export const structuredLogger = new StructuredLogger();

// Legacy logger for backward compatibility
export const logger = structuredLogger;

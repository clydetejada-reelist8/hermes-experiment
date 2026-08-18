import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { structuredLogger, type LogEntry } from "./logger.js";
import { HermesError } from "./errors.js";
import { metrics } from "./metrics.js";

describe("structuredLogger", () => {
  let capturedLogs: LogEntry[] = [];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    capturedLogs = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      const entry = JSON.parse(args[0] as string) as LogEntry;
      capturedLogs.push(entry);
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("logs info level with structured fields", () => {
    structuredLogger.info("test_event", { userId: "123", action: "login" });
    expect(capturedLogs).toHaveLength(1);
    expect(capturedLogs[0]!.level).toBe("info");
    expect(capturedLogs[0]!.event).toBe("test_event");
    expect(capturedLogs[0]!.fields.userId).toBe("123");
    expect(capturedLogs[0]!.timestamp).toBeTruthy();
  });

  it("logs error level with error details", () => {
    structuredLogger.error("test_error", { error: "something failed", code: "ERR_001" });
    expect(capturedLogs[0]!.level).toBe("error");
    expect(capturedLogs[0]!.fields.error).toBe("something failed");
    expect(capturedLogs[0]!.fields.code).toBe("ERR_001");
  });

  it("logs warn level", () => {
    structuredLogger.warn("test_warn", { reason: "deprecated" });
    expect(capturedLogs[0]!.level).toBe("warn");
  });

  it("logs debug level", () => {
    structuredLogger.debug("test_debug", { detail: "internal" });
    expect(capturedLogs[0]!.level).toBe("debug");
  });

  it("includes correlation ID when set", () => {
    structuredLogger.setCorrelationId("corr-123");
    structuredLogger.info("with_correlation", {});
    expect(capturedLogs[0]!.correlationId).toBe("corr-123");
    structuredLogger.clearCorrelationId();
  });

  it("includes request ID when set", () => {
    structuredLogger.setRequestId("req-456");
    structuredLogger.info("with_request", {});
    expect(capturedLogs[0]!.requestId).toBe("req-456");
    structuredLogger.clearRequestId();
  });

  it("does not include correlation/request ID when not set", () => {
    structuredLogger.info("no_ids", {});
    expect(capturedLogs[0]!.correlationId).toBeUndefined();
    expect(capturedLogs[0]!.requestId).toBeUndefined();
  });
});

describe("error semantics", () => {
  it("creates HermesError with code and category", () => {
    const err = new HermesError("VALIDATION_ERROR", "Invalid input", {
      category: "client_error",
      statusCode: 400,
      details: { field: "email" },
    });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.category).toBe("client_error");
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Invalid input");
    expect(err.details).toEqual({ field: "email" });
  });

  it("is an instance of Error", () => {
    const err = new HermesError("INTERNAL_ERROR", "Something broke", { category: "server_error" });
    expect(err).toBeInstanceOf(Error);
  });

  it("serializes to JSON with all fields", () => {
    const err = new HermesError("NOT_FOUND", "Resource missing", {
      category: "client_error",
      statusCode: 404,
    });
    const json = err.toJSON();
    expect(json.code).toBe("NOT_FOUND");
    expect(json.category).toBe("client_error");
    expect(json.statusCode).toBe(404);
    expect(json.message).toBe("Resource missing");
  });
});

describe("metrics", () => {
  it("records a counter metric", () => {
    metrics.reset();
    metrics.increment("requests_total", { method: "GET" });
    expect(metrics.getCount("requests_total", { method: "GET" })).toBe(1);
  });

  it("increments counter multiple times", () => {
    metrics.reset();
    metrics.increment("requests_total", { method: "POST" });
    metrics.increment("requests_total", { method: "POST" });
    metrics.increment("requests_total", { method: "POST" });
    expect(metrics.getCount("requests_total", { method: "POST" })).toBe(3);
  });

  it("records a timing metric", () => {
    metrics.reset();
    metrics.timing("request_duration_ms", 42, { endpoint: "/api/ask" });
    expect(metrics.getTimings("request_duration_ms", { endpoint: "/api/ask" })).toEqual([42]);
  });

  it("records multiple timings", () => {
    metrics.reset();
    metrics.timing("request_duration_ms", 10, { endpoint: "/api/ask" });
    metrics.timing("request_duration_ms", 20, { endpoint: "/api/ask" });
    metrics.timing("request_duration_ms", 30, { endpoint: "/api/ask" });
    const timings = metrics.getTimings("request_duration_ms", { endpoint: "/api/ask" });
    expect(timings).toEqual([10, 20, 30]);
  });

  it("separates metrics with different labels", () => {
    metrics.reset();
    metrics.increment("requests_total", { method: "GET" });
    metrics.increment("requests_total", { method: "POST" });
    expect(metrics.getCount("requests_total", { method: "GET" })).toBe(1);
    expect(metrics.getCount("requests_total", { method: "POST" })).toBe(1);
  });
});

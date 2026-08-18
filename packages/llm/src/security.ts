export interface InjectionResult {
  detected: boolean;
  patterns: string[];
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Prompt injection detection patterns.
 *
 * These are DETERMINISTIC checks — no model authority. They detect common
 * prompt injection attempts in user messages and retrieved content.
 */
const INJECTION_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "ignore_instructions",
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i,
  },
  {
    name: "disregard_instructions",
    pattern: /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i,
  },
  { name: "role_hijack", pattern: /you\s+are\s+now\s+(?:a|an)\s+/i },
  {
    name: "system_prompt_extraction",
    pattern: /(?:show|reveal|print|display|output)\s+(?:me\s+)?(?:your\s+)?system\s+prompt/i,
  },
  { name: "reveal_instructions", pattern: /reveal\s+(?:your\s+)?instructions/i },
  { name: "jailbreak_dan", pattern: /\bDAN\b.*(?:do anything now|no restrictions)/i },
  {
    name: "developer_mode",
    pattern: /(?:enter|enable|activate)\s+(?:developer|god|root|admin)\s+mode/i,
  },
  {
    name: "pretend_mode",
    pattern: /pretend\s+(?:you\s+are|to be)\s+(?:a|an)\s+(?:different|unrestricted|unfiltered)/i,
  },
];

/**
 * Detect prompt injection attempts in text.
 * Returns detected=true if any injection pattern matches.
 */
export function detectPromptInjection(text: string): InjectionResult {
  const matched: string[] = [];
  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(name);
    }
  }
  return { detected: matched.length > 0, patterns: matched };
}

/**
 * Sanitize text for inclusion in an LLM prompt.
 *
 * - Removes detected injection patterns
 * - Wraps content in safety markers so the model knows it's untrusted content
 */
export function sanitizeForLLM(text: string): string {
  let sanitized = text;
  for (const { pattern } of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return `[USER CONTENT]\n${sanitized}\n[/USER CONTENT]`;
}

/**
 * SSRF protection — validate that a URL is safe to fetch.
 *
 * Blocks:
 *   - Non-HTTP/HTTPS protocols (file://, ftp://, etc.)
 *   - Localhost (127.0.0.1, localhost, ::1)
 *   - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 *   - Link-local addresses (169.254.x, including cloud metadata)
 *   - 0.0.0.0
 */
export function validateUrl(urlStr: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: "invalid URL format" };
  }

  // Only allow HTTP and HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: `blocked protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost
  if (hostname === "localhost") {
    return { valid: false, reason: "blocked: localhost" };
  }

  // Block IPv6 localhost
  if (hostname === "[::1]" || hostname === "::1") {
    return { valid: false, reason: "blocked: IPv6 localhost" };
  }

  // Block 0.0.0.0
  if (hostname === "0.0.0.0" || hostname === "[::]") {
    return { valid: false, reason: "blocked: wildcard address" };
  }

  // Check for IP addresses
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match;
    const aNum = parseInt(a!, 10);
    const bNum = parseInt(b!, 10);

    // Block 127.x.x.x (loopback)
    if (aNum === 127) {
      return { valid: false, reason: "blocked: loopback address" };
    }

    // Block 10.x.x.x (private)
    if (aNum === 10) {
      return { valid: false, reason: "blocked: private IP range (10.x)" };
    }

    // Block 172.16-31.x.x (private)
    if (aNum === 172 && bNum >= 16 && bNum <= 31) {
      return { valid: false, reason: "blocked: private IP range (172.16-31.x)" };
    }

    // Block 192.168.x.x (private)
    if (aNum === 192 && bNum === 168) {
      return { valid: false, reason: "blocked: private IP range (192.168.x)" };
    }

    // Block 169.254.x.x (link-local, includes cloud metadata)
    if (aNum === 169 && bNum === 254) {
      return { valid: false, reason: "blocked: link-local/metadata address" };
    }
  }

  return { valid: true };
}

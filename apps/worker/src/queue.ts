import net from "node:net";

export interface QueueJob<T> {
  id: string;
  name: string;
  data: T;
}

export function encodeRedisCommand(args: string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
  return Buffer.from(parts.join(""), "utf8");
}

export class RedisListQueue {
  constructor(private readonly url: string) {}

  async enqueue<T>(queue: string, job: QueueJob<T>): Promise<void> {
    await this.command(["LPUSH", queue, JSON.stringify(job)]);
  }

  async dequeue<T>(queue: string, timeoutSeconds = 5): Promise<QueueJob<T> | null> {
    const response = await this.command(["BRPOP", queue, String(timeoutSeconds)]);
    if (!Array.isArray(response) || response.length < 2 || typeof response[1] !== "string") return null;
    return JSON.parse(response[1]) as QueueJob<T>;
  }

  private command(args: string[]): Promise<unknown> {
    const parsed = new URL(this.url);
    const port = Number(parsed.port || 6379);
    const host = parsed.hostname || "127.0.0.1";
    const password = parsed.password;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      let buffer = Buffer.alloc(0) as Buffer;
      const commands = password ? [encodeRedisCommand(["AUTH", password]), encodeRedisCommand(args)] : [encodeRedisCommand(args)];
      let commandIndex = 0;
      const sendNext = () => socket.write(commands[commandIndex++] as Buffer);
      socket.on("connect", sendNext);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]) as Buffer;
        while (true) {
          const parsedResponse = parseRedisResponse(buffer);
          if (!parsedResponse) break;
          buffer = parsedResponse.rest;
          if (commandIndex < commands.length) {
            sendNext();
          } else {
            socket.end();
            resolve(parsedResponse.value);
            return;
          }
        }
      });
      socket.on("error", reject);
      socket.on("timeout", () => reject(new Error("redis_timeout")));
      socket.setTimeout(10_000);
    });
  }
}

interface ParsedResponse {
  value: unknown;
  rest: Buffer;
}

function parseRedisResponse(buffer: Buffer): ParsedResponse | null {
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd < 0) return null;
  const prefix = String.fromCharCode(buffer[0] ?? 0);
  const header = buffer.subarray(1, lineEnd).toString("utf8");
  if (prefix === "+" || prefix === ":") {
    return { value: prefix === ":" ? Number(header) : header, rest: buffer.subarray(lineEnd + 2) };
  }
  if (prefix === "-") throw new Error(header);
  if (prefix === "$" || prefix === "*") {
    const length = Number(header);
    if (length === -1) return { value: null, rest: buffer.subarray(lineEnd + 2) };
    if (prefix === "$") {
      const end = lineEnd + 2 + length + 2;
      if (buffer.length < end) return null;
      return {
        value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString("utf8"),
        rest: buffer.subarray(end),
      };
    }
    let rest = buffer.subarray(lineEnd + 2);
    const values: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
      const parsed = parseRedisResponse(rest);
      if (!parsed) return null;
      values.push(parsed.value);
      rest = parsed.rest;
    }
    return { value: values, rest };
  }
  throw new Error("redis_protocol_error");
}

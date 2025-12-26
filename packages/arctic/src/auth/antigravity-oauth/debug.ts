import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const DEBUG_FLAG = process.env.ARCTIC_ANTIGRAVITY_DEBUG ?? "";
const MAX_BODY_PREVIEW_CHARS = 12000;
const MAX_BODY_VERBOSE_CHARS = 50000;

export const DEBUG_MESSAGE_PREFIX = "[arctic-antigravity-auth debug]";

// Debug levels: 0 = off, 1 = basic, 2 = verbose (full bodies)
const debugLevel = parseDebugLevel(DEBUG_FLAG);
const debugEnabled = debugLevel >= 1;
const verboseEnabled = debugLevel >= 2;
const logFilePath = debugEnabled ? defaultLogFilePath() : undefined;
const logWriter = createLogWriter(logFilePath);

function parseDebugLevel(flag: string): number {
  const trimmed = flag.trim();
  if (trimmed === "2" || trimmed === "verbose") return 2;
  if (trimmed === "1" || trimmed === "true") return 1;
  return 0;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

export function isVerboseEnabled(): boolean {
  return verboseEnabled;
}

export function getLogFilePath(): string | undefined {
  return logFilePath;
}

export interface AntigravityDebugContext {
  id: string;
  streaming: boolean;
  startedAt: number;
}

interface AntigravityDebugRequestMeta {
  originalUrl: string;
  resolvedUrl: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  streaming: boolean;
  projectId?: string;
}

interface AntigravityDebugResponseMeta {
  body?: string;
  note?: string;
  error?: unknown;
  headersOverride?: HeadersInit;
}

let requestCounter = 0;

/**
 * Begins a debug trace for an Antigravity request, logging request metadata when debugging is enabled.
 */
export function startAntigravityDebugRequest(
  meta: AntigravityDebugRequestMeta,
): AntigravityDebugContext | null {
  if (!debugEnabled) {
    return null;
  }

  const id = `ANTIGRAVITY-${++requestCounter}`;
  const method = meta.method ?? "GET";
  logDebug(`[Antigravity Debug ${id}] ${method} ${meta.resolvedUrl}`);
  if (meta.originalUrl && meta.originalUrl !== meta.resolvedUrl) {
    logDebug(`[Antigravity Debug ${id}] Original URL: ${meta.originalUrl}`);
  }
  if (meta.projectId) {
    logDebug(`[Antigravity Debug ${id}] Project: ${meta.projectId}`);
  }
  logDebug(`[Antigravity Debug ${id}] Streaming: ${meta.streaming ? "yes" : "no"}`);
  logDebug(`[Antigravity Debug ${id}] Headers: ${JSON.stringify(maskHeaders(meta.headers))}`);
  const bodyPreview = formatBodyPreview(meta.body);
  if (bodyPreview) {
    logDebug(`[Antigravity Debug ${id}] Body Preview: ${bodyPreview}`);
  }

  return { id, streaming: meta.streaming, startedAt: Date.now() };
}

/**
 * Logs response details for a previously started debug trace when debugging is enabled.
 */
export function logAntigravityDebugResponse(
  context: AntigravityDebugContext | null | undefined,
  response: Response,
  meta: AntigravityDebugResponseMeta = {},
): void {
  if (!debugEnabled || !context) {
    return;
  }

  const durationMs = Date.now() - context.startedAt;
  logDebug(
    `[Antigravity Debug ${context.id}] Response ${response.status} ${response.statusText} (${durationMs}ms)`,
  );
  logDebug(
    `[Antigravity Debug ${context.id}] Response Headers: ${JSON.stringify(
      maskHeaders(meta.headersOverride ?? response.headers),
    )}`,
  );

  if (meta.note) {
    logDebug(`[Antigravity Debug ${context.id}] Note: ${meta.note}`);
  }

  if (meta.error) {
    logDebug(`[Antigravity Debug ${context.id}] Error: ${formatError(meta.error)}`);
  }

  if (meta.body) {
    logDebug(`[Antigravity Debug ${context.id}] Response Body Preview: ${truncateForLog(meta.body)}`);
  }
}

/**
 * Obscures sensitive headers and returns a plain object for logging.
 */
function maskHeaders(headers?: HeadersInit | Headers): Record<string, string> {
  if (!headers) {
    return {};
  }

  const result: Record<string, string> = {};
  const parsed = headers instanceof Headers ? headers : new Headers(headers);
  parsed.forEach((value, key) => {
    if (key.toLowerCase() === "authorization") {
      result[key] = "[redacted]";
    } else {
      result[key] = value;
    }
  });
  return result;
}

/**
 * Produces a short, type-aware preview of a request/response body for logs.
 */
function formatBodyPreview(body?: BodyInit | null): string | undefined {
  if (body == null) {
    return undefined;
  }

  if (typeof body === "string") {
    return truncateForLog(body);
  }

  if (body instanceof URLSearchParams) {
    return truncateForLog(body.toString());
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `[Blob size=${body.size}]`;
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return "[FormData payload omitted]";
  }

  return `[${body.constructor?.name ?? typeof body} payload omitted]`;
}

/**
 * Truncates long strings to a fixed preview length for logging.
 */
function truncateForLog(text: string): string {
  if (text.length <= MAX_BODY_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_BODY_PREVIEW_CHARS)}... (truncated ${text.length - MAX_BODY_PREVIEW_CHARS} chars)`;
}

/**
 * Writes a single debug line using the configured writer.
 */
function logDebug(line: string): void {
  logWriter(line);
}

/**
 * Converts unknown error-like values into printable strings.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Returns the logs directory inside the arctic config folder.
 */
function getLogsDir(): string {
  const logsDir = process.env.ARCTIC_ANTIGRAVITY_LOG_DIR || join(homedir(), ".arctic", "antigravity-logs");

  // Create directory asynchronously - don't block
  mkdir(logsDir, { recursive: true }).catch(() => {
    // Ignore errors - directory may already exist or we don't have permission
  });

  return logsDir;
}

/**
 * Builds a timestamped log file path in the arctic logs directory.
 */
function defaultLogFilePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(getLogsDir(), `antigravity-debug-${timestamp}.log`);
}

function createLogWriter(filePath?: string): (line: string) => void {
  if (!filePath) {
    return () => {};
  }

  try {
    const stream = createWriteStream(filePath, { flags: "a" });
    stream.on("error", () => {});
    return (line: string) => {
      const timestamp = new Date().toISOString();
      const formatted = `[${timestamp}] ${line}`;
      stream.write(`${formatted}\n`);
    };
  } catch {
    return () => {};
  }
}

export interface AccountDebugInfo {
  index: number;
  email?: string;
  family: string;
  totalAccounts: number;
  rateLimitState?: { claude?: number; gemini?: number };
}

export function logAccountContext(label: string, info: AccountDebugInfo): void {
  if (!debugEnabled) return;

  const accountLabel = info.email ? info.email : info.index >= 0 ? `Account ${info.index + 1}` : "All accounts";

  const indexLabel = info.index >= 0 ? `${info.index + 1}/${info.totalAccounts}` : `-/${info.totalAccounts}`;

  const rateLimitInfo = info.rateLimitState ? ` rateLimits=${JSON.stringify(info.rateLimitState)}` : "";

  logDebug(`[Account] ${label}: ${accountLabel} (${indexLabel}) family=${info.family}${rateLimitInfo}`);
}

export function logRateLimitEvent(
  accountIndex: number,
  email: string | undefined,
  family: string,
  status: number,
  retryAfterMs: number,
  bodyInfo: { message?: string; quotaResetTime?: string; retryDelayMs?: number | null; reason?: string },
): void {
  if (!debugEnabled) return;
  const accountLabel = email || `Account ${accountIndex + 1}`;
  logDebug(`[RateLimit] ${status} on ${accountLabel} family=${family} retryAfterMs=${retryAfterMs}`);
  if (bodyInfo.message) {
    logDebug(`[RateLimit] message: ${bodyInfo.message}`);
  }
  if (bodyInfo.quotaResetTime) {
    logDebug(`[RateLimit] quotaResetTime: ${bodyInfo.quotaResetTime}`);
  }
  if (bodyInfo.retryDelayMs !== undefined && bodyInfo.retryDelayMs !== null) {
    logDebug(`[RateLimit] body retryDelayMs: ${bodyInfo.retryDelayMs}`);
  }
  if (bodyInfo.reason) {
    logDebug(`[RateLimit] reason: ${bodyInfo.reason}`);
  }
}

export function logRateLimitSnapshot(
  family: string,
  accounts: Array<{ index: number; email?: string; rateLimitResetTimes?: { claude?: number; gemini?: number } }>,
): void {
  if (!debugEnabled) return;
  const now = Date.now();
  const entries = accounts.map((account) => {
    const label = account.email ? account.email : `Account ${account.index + 1}`;
    const reset = account.rateLimitResetTimes?.[family as "claude" | "gemini"];
    if (typeof reset !== "number") {
      return `${label}=ready`;
    }
    const remaining = Math.max(0, reset - now);
    const seconds = Math.ceil(remaining / 1000);
    return `${label}=wait ${seconds}s`;
  });
  logDebug(`[RateLimit] snapshot family=${family} ${entries.join(" | ")}`);
}

export async function logResponseBody(
  context: AntigravityDebugContext | null | undefined,
  response: Response,
  status: number,
): Promise<string | undefined> {
  if (!debugEnabled || !context) return undefined;

  const isError = status >= 400;
  const shouldLogBody = verboseEnabled || isError;

  if (!shouldLogBody) return undefined;

  try {
    const text = await response.clone().text();
    const maxChars = verboseEnabled ? MAX_BODY_VERBOSE_CHARS : MAX_BODY_PREVIEW_CHARS;
    const preview =
      text.length <= maxChars ? text : `${text.slice(0, maxChars)}... (truncated ${text.length - maxChars} chars)`;
    logDebug(`[Antigravity Debug ${context.id}] Response Body (${status}): ${preview}`);
    return text;
  } catch (e) {
    logDebug(`[Antigravity Debug ${context.id}] Failed to read response body: ${formatError(e)}`);
    return undefined;
  }
}

export function logModelFamily(url: string, extractedModel: string | null, family: string): void {
  if (!debugEnabled) return;
  logDebug(`[ModelFamily] url=${url} model=${extractedModel ?? "unknown"} family=${family}`);
}

export function debugLogToFile(message: string): void {
  if (!debugEnabled) return;
  logDebug(message);
}

import { z } from "zod";
import { tool } from "ai";
import mammoth from "mammoth";
// import pdfParse from "pdf-parse"; // Removed - using AI SDK instead
import { Valyu } from "valyu-js";
import { track } from "@vercel/analytics/server";
import { PolarEventTracker } from "@/lib/polar-events";
import { Daytona } from "@daytonaio/sdk";
import { createHash } from "node:crypto";

// In-flight dedupe
const inflight = new Map<string, Promise<any>>();
function inflightKey(tool: string, query: string, opts?: any) {
  return `${tool}::${query.trim().toLowerCase()}::${JSON.stringify(
    opts || {}
  )}`;
}

async function once<T>(
  tool: string,
  query: string,
  opts: any,
  run: () => Promise<T>
): Promise<T> {
  const key = inflightKey(tool, query, opts);
  if (inflight.has(key)) return inflight.get(key)! as Promise<T>;
  const p = (async () => {
    try {
      return await run();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// URL normalization + ID helpers
function canonQuery(q?: string) {
  return (q || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function canonOptions(input: any): any {
  if (Array.isArray(input)) {
    return [...input]
      .map(canonOptions)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (input && typeof input === "object") {
    const out: any = {};
    Object.keys(input)
      .sort()
      .forEach((k) => {
        const v = (input as any)[k];
        if (v === undefined || v === null) return;
        out[k] = canonOptions(v);
      });
    return out;
  }
  return input;
}

function buildToolKey(tool: string, query: string, opts: any) {
  return `${tool}::${canonQuery(query)}::${JSON.stringify(canonOptions(opts))}`;
}
function normalizeUrl(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.hash = "";
    // strip tracking params
    for (const k of Array.from(u.searchParams.keys())) {
      if (k.startsWith("utm_") || k === "ref" || k === "ref_src")
        u.searchParams.delete(k);
    }
    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    const qs = u.searchParams.toString();
    return `${u.protocol}//${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return (url || "").trim();
  }
}
function keyToUuid(key: string) {
  const hash = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function extractArxivId(url?: string) {
  if (!url) return undefined;
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([\w.\-]+)/i);
  return m?.[1];
}
function extractDoi(s?: string) {
  if (!s) return undefined;
  const m = s.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m?.[0]?.toLowerCase();
}

function resultId(r: any) {
  const key =
    r.nct_id ||
    r.data?.nct_id ||
    r.metadata?.pmid ||
    r.pmid ||
    r.metadata?.doi ||
    r.doi ||
    r.metadata?.setid ||
    extractArxivId(r.url) ||
    normalizeUrl(r.url) ||
    `${(r.title || "").toLowerCase()}|${(r.source || "").toLowerCase()}|${
      r.date || ""
    }`;
  return keyToUuid(key);
}
function dedupeBy<T>(arr: T[], getId: (x: T) => string) {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const id = getId(x);
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function extractMissingModuleName(message?: string) {
  if (!message) return null;
  const match = message.match(
    /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/
  );
  return match ? match[1] : null;
}

function escapeModuleTag(text?: string | null) {
  if (!text) return text || "";
  return text.replace(/<module>/g, "&lt;module&gt;");
}

type ValidationStatus = "pass" | "fail";

type ValidationItem = {
  label: string;
  status: ValidationStatus;
  detail: string;
};

function formatValidationSummary(items: ValidationItem[]) {
  if (!items.length) return "";
  const lines = items.map((item) => {
    const icon = item.status === "pass" ? "✅" : "❌";
    return `${icon} ${item.label}: ${item.detail}`;
  });
  return `🔍 **Validation Checks**\n${lines.join("\n")}`;
}

function extractImportedModules(code: string) {
  const modules = new Set<string>();
  const lines = code.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const fromMatch = line.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+/);
    if (fromMatch) {
      const base = fromMatch[1];
      if (!base.startsWith(".")) {
        modules.add(base.split(".")[0]);
      }
      continue;
    }

    const importMatch = line.match(/^import\s+(.+)/);
    if (importMatch) {
      const targets = importMatch[1]
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);

      for (const target of targets) {
        if (target.startsWith(".")) continue;
        const base = target
          .split(/\s+as\s+/i)[0]
          .split(".")[0]
          .trim();
        if (base) modules.add(base);
      }
    }
  }

  return Array.from(modules);
}

function detectCodeIssues(code: string): ValidationItem | null {
  const lines = code.split(/\r?\n/);
  const numpyAliases = new Set<string>();
  let importsNumpy = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const importAlias = line.match(
      /^import\s+numpy\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/
    );
    if (importAlias) {
      numpyAliases.add(importAlias[1]);
      importsNumpy = true;
      continue;
    }

    if (/^import\s+numpy\b/.test(line) || /^from\s+numpy\b/.test(line)) {
      numpyAliases.add("numpy");
      importsNumpy = true;
    }
  }

  if (importsNumpy) {
    const usesNpIdentifier = /\bnp\s*\./.test(code);
    const overridesNp = /(^|[^A-Za-z0-9_])np\s*=\s*/.test(code);
    const hasNpAlias = numpyAliases.has("np");

    if (usesNpIdentifier && !hasNpAlias) {
      return {
        label: "NumPy Alias Safety",
        status: "fail",
        detail:
          "The code calls `np.` functions but never assigns the `np` alias. Import NumPy as `np` (not allowed here) or reference the chosen alias consistently.",
      };
    }

    if (overridesNp) {
      return {
        label: "NumPy Alias Safety",
        status: "fail",
        detail:
          "The identifier `np` is reassigned in the script, so subsequent calls like `np.exp()` will break. Avoid assigning new values to `np` after importing NumPy.",
      };
    }
  }

  return null;
}

// Per-request dedupe across tools (no TTL; resets each server process restart)
const seenByRequest = new Map<string, Set<string>>();
function dedupeAgainstRequest<T>(
  requestId: string | undefined,
  items: T[],
  getId: (x: T) => string
) {
  if (!requestId) return items;
  let bag = seenByRequest.get(requestId);
  if (!bag) {
    bag = new Set();
    seenByRequest.set(requestId, bag);
  }
  return items.filter((x) => {
    const id = getId(x);
    if (!id || bag!.has(id)) return false;
    bag!.add(id);
    return true;
  });
}

// Per-session in-memory memo (no TTL). Collapses repeat queries across the same chat session.
const memoBySession = new Map<string, Map<string, any>>();
const SESSION_MEMO_MAX_KEYS = 200;

async function withSessionMemo<T>(
  sessionId: string | undefined,
  key: string,
  run: () => Promise<T>
): Promise<T> {
  if (!sessionId) return run();
  let bag = memoBySession.get(sessionId);
  if (!bag) {
    bag = new Map();
    memoBySession.set(sessionId, bag);
  }
  if (bag.has(key)) return bag.get(key) as T;
  const value = await run();
  // Simple LRU-ish: evict oldest when at capacity
  if (bag.size >= SESSION_MEMO_MAX_KEYS) {
    const firstKey = bag.keys().next().value;
    if (firstKey) bag.delete(firstKey);
  }
  bag.set(key, value);
  return value;
}

function logDedupe(
  tool: string,
  requestId: string | undefined,
  raw: number,
  mapped: number,
  unique: number,
  final: any[]
) {
  console.log(`[${tool}] dedupe`, {
    requestId,
    raw,
    mapped,
    unique,
    final: final.length,
    ids: final.map((x: any) => x.id).slice(0, 50),
  });
}

export const everythingTools = {
  // File reading tools - allow the model to read user-provided files via URLs
  readTextFromUrl: tool({
    description:
      "Fetch a plain text or text-like file from a URL and return its contents. Accepts text/*, application/json, and common code/text formats.",
    inputSchema: z.object({
      url: z.string().url().describe("Publicly accessible URL to the file"),
      maxBytes: z
        .number()
        .min(1024)
        .max(25 * 1024 * 1024)
        .optional()
        .default(10 * 1024 * 1024)
        .describe("Maximum bytes to download (default 10MB, max 25MB)"),
      charset: z
        .string()
        .optional()
        .describe("Optional character set hint, e.g., 'utf-8'"),
    }),
    execute: async ({ url, maxBytes, charset }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          return `❌ Failed to fetch URL (status ${res.status})`;
        }
        const contentType = res.headers.get("content-type") || "";
        const isTextLike =
          contentType.startsWith("text/") ||
          contentType.includes("application/json") ||
          contentType.includes("application/xml") ||
          contentType.includes("+json") ||
          contentType.includes("+xml");
        if (!isTextLike) {
          return `❌ Unsupported content-type for readTextFromUrl: ${contentType}`;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          const text = await res.text();
          return text;
        }
        const limit = maxBytes || 10 * 1024 * 1024;
        const chunks: Uint8Array[] = [];
        let downloaded = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            if (downloaded > limit) {
              return `❌ File exceeds maxBytes limit (${limit} bytes)`;
            }
            chunks.push(value);
          }
        }
        const buffer = Buffer.concat(chunks);
        return buffer.toString((charset as BufferEncoding) || "utf-8");
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return "⏱️ Timeout fetching the URL (15s).";
        }
        return `❌ Error fetching text: ${err?.message || String(err)}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  }),

  parsePdfFromUrl: tool({
    description:
      "Download a PDF from a URL and extract its text content. Returns plain text.",
    inputSchema: z.object({
      url: z.string().url().describe("Publicly accessible URL to the PDF"),
      maxBytes: z
        .number()
        .min(1024)
        .max(25 * 1024 * 1024)
        .optional()
        .default(20 * 1024 * 1024)
        .describe("Maximum bytes to download (default 20MB, max 25MB)"),
    }),
    execute: async ({ url, maxBytes }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          return `❌ Failed to fetch URL (status ${res.status})`;
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("pdf")) {
          return `❌ URL does not appear to be a PDF (content-type: ${contentType})`;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          const arrayBuffer = await res.arrayBuffer();
          // Use AI SDK for PDF processing instead of pdf-parse
          const { generateText } = await import("ai");
          const { openai } = await import("@ai-sdk/openai");

          try {
            const result = await generateText({
              model: openai("gpt-5"),
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "Extract all text content from this PDF file.",
                    },
                    {
                      type: "file",
                      data: Buffer.from(arrayBuffer),
                      mediaType: "application/pdf",
                      filename: "document.pdf",
                    },
                  ],
                },
              ],
            });
            return result.text || "";
          } catch (error) {
            return `❌ Error processing PDF with AI SDK: ${
              error instanceof Error ? error.message : String(error)
            }`;
          }
        }
        const limit = maxBytes || 20 * 1024 * 1024;
        const chunks: Uint8Array[] = [];
        let downloaded = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            downloaded += value.byteLength;
            if (downloaded > limit) {
              return `❌ PDF exceeds maxBytes limit (${limit} bytes)`;
            }
            chunks.push(value);
          }
        }
        const buffer = Buffer.concat(chunks);

        // Use AI SDK for PDF processing instead of pdf-parse
        const { generateText } = await import("ai");
        const { openai } = await import("@ai-sdk/openai");

        try {
          const result = await generateText({
            model: openai("gpt-5"),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extract all text content from this PDF file.",
                  },
                  {
                    type: "file",
                    data: buffer,
                    mediaType: "application/pdf",
                    filename: "document.pdf",
                  },
                ],
              },
            ],
          });
          return result.text || "";
        } catch (error) {
          return `❌ Error processing PDF with AI SDK: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return "⏱️ Timeout fetching the PDF (20s).";
        }
        return `❌ Error parsing PDF: ${err?.message || String(err)}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  }),

  parseDocxFromUrl: tool({
    description:
      "Download a DOCX from a URL and extract its text content using mammoth.",
    inputSchema: z.object({
      url: z.string().url().describe("Publicly accessible URL to the DOCX"),
      maxBytes: z
        .number()
        .min(1024)
        .max(25 * 1024 * 1024)
        .optional()
        .default(15 * 1024 * 1024)
        .describe("Maximum bytes to download (default 15MB, max 25MB)"),
    }),
    execute: async ({ url, maxBytes }) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          return `❌ Failed to fetch URL (status ${res.status})`;
        }
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("word") && !contentType.includes("docx")) {
          // Allow even if header is missing; just warn
          // return `❌ URL does not appear to be a DOCX (content-type: ${contentType})`;
        }
        const reader = res.body?.getReader();
        const limit = maxBytes || 15 * 1024 * 1024;
        const chunks: Uint8Array[] = [];
        let downloaded = 0;
        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              downloaded += value.byteLength;
              if (downloaded > limit) {
                return `❌ DOCX exceeds maxBytes limit (${limit} bytes)`;
              }
              chunks.push(value);
            }
          }
        } else {
          const ab = await res.arrayBuffer();
          if (ab.byteLength > limit) {
            return `❌ DOCX exceeds maxBytes limit (${limit} bytes)`;
          }
          chunks.push(new Uint8Array(ab));
        }
        const buffer = Buffer.concat(chunks);
        const { value } = await mammoth.extractRawText({ buffer });
        return value || "";
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return "⏱️ Timeout fetching the DOCX (20s).";
        }
        return `❌ Error parsing DOCX: ${err?.message || String(err)}`;
      } finally {
        clearTimeout(timeout);
      }
    },
  }),
  // Chart Creation Tool - Create interactive charts for data visualization
  createChart: tool({
    description: `Create interactive charts for clinical and research data visualization. 
    
    CRITICAL: ALL FIVE FIELDS ARE REQUIRED:
    1. title - Chart title (e.g., "Drug Efficacy Comparison", "Patient Response Rates")
    2. type - Chart type: "line", "bar", or "area" 
    3. xAxisLabel - X-axis label (e.g., "Time (weeks)", "Treatment Group")
    4. yAxisLabel - Y-axis label (e.g., "Response Rate (%)", "Survival Probability")
    5. dataSeries - Array of data series with this exact format:
    
    Example complete tool call:
    {
      "title": "CAR-T vs Chemotherapy Response Rates",
      "type": "line",
      "xAxisLabel": "Weeks Since Treatment",
      "yAxisLabel": "Response Rate (%)",
      "dataSeries": [
        {
          "name": "CAR-T Therapy",
          "data": [
            {"x": "Week 0", "y": 0},
            {"x": "Week 4", "y": 65.5},
            {"x": "Week 8", "y": 78.2}
          ]
        },
        {
          "name": "Standard Chemotherapy",
          "data": [
            {"x": "Week 0", "y": 0},
            {"x": "Week 4", "y": 32.1},
            {"x": "Week 8", "y": 38.5}
          ]
        }
      ]
    }
    
    NEVER omit any of the five required fields. Each data point must have x (date/label) and y (numeric value).`,
    inputSchema: z.object({
      title: z
        .string()
        .describe('Chart title (e.g., "Apple vs Microsoft Stock Performance")'),
      type: z
        .enum(["line", "bar", "area"])
        .describe(
          'Chart type - use "line" for time series data like stock prices'
        ),
      xAxisLabel: z
        .string()
        .describe('X-axis label (e.g., "Date", "Quarter", "Year")'),
      yAxisLabel: z
        .string()
        .describe(
          'Y-axis label (e.g., "Price ($)", "Revenue (Millions)", "Percentage (%)")'
        ),
      dataSeries: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                'Series name - include company/ticker for stocks (e.g., "Apple (AAPL)", "Tesla Revenue")'
              ),
            data: z
              .array(
                z.object({
                  x: z
                    .union([z.string(), z.number()])
                    .describe(
                      'X-axis value - use date strings like "2024-01-01" for time series'
                    ),
                  y: z
                    .number()
                    .describe(
                      "Y-axis numeric value - stock price, revenue, percentage, etc."
                    ),
                })
              )
              .describe(
                "Array of data points with x (date/label) and y (value) properties"
              ),
          })
        )
        .describe(
          "REQUIRED: Array of data series - each series has name and data array with x,y objects"
        ),
      description: z
        .string()
        .optional()
        .describe("Optional description explaining what the chart shows"),
    }),
    execute: async ({
      title,
      type,
      xAxisLabel,
      yAxisLabel,
      dataSeries,
      description,
    }) => {
      // Track chart creation
      await track("Chart Created", {
        chartType: type,
        title: title,
        seriesCount: dataSeries.length,
        totalDataPoints: dataSeries.reduce(
          (sum, series) => sum + series.data.length,
          0
        ),
        hasDescription: !!description,
      });

      // Enhanced date parsing for multiple formats (same logic as FinancialChart)
      const parseDate = (dateStr: string | number): Date | null => {
        if (typeof dateStr === "number") return new Date(dateStr);

        // Try multiple date formats in order of preference
        const formats = [
          // ISO format (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss, etc.)
          (str: string) => {
            const date = new Date(str);
            return !isNaN(date.getTime()) ? date : null;
          },
          // YYYY-MM-DD format
          (str: string) => {
            const match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (match) {
              const [, year, month, day] = match;
              return new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day)
              );
            }
            return null;
          },
          // DD/MM/YYYY format (common in European/international contexts)
          (str: string) => {
            const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
              const [, day, month, year] = match;
              const dayNum = parseInt(day);
              const monthNum = parseInt(month);
              const yearNum = parseInt(year);

              // Validate that day <= 31 and month <= 12 (basic validation)
              if (dayNum <= 31 && monthNum <= 12) {
                const parsedDate = new Date(yearNum, monthNum - 1, dayNum);
                // Additional validation: check if the parsed date components match
                if (
                  parsedDate.getDate() === dayNum &&
                  parsedDate.getMonth() === monthNum - 1
                ) {
                  return parsedDate;
                }
              }
            }
            return null;
          },
          // MM/DD/YYYY format (common in US contexts)
          (str: string) => {
            const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
              const [, month, day, year] = match;
              const monthNum = parseInt(month);
              const dayNum = parseInt(day);
              const yearNum = parseInt(year);

              // Validate that month <= 12 and day <= 31 (basic validation)
              if (monthNum <= 12 && dayNum <= 31) {
                const parsedDate = new Date(yearNum, monthNum - 1, dayNum);
                // Additional validation: check if the parsed date components match
                if (
                  parsedDate.getMonth() === monthNum - 1 &&
                  parsedDate.getDate() === dayNum
                ) {
                  return parsedDate;
                }
              }
            }
            return null;
          },
        ];

        for (const format of formats) {
          try {
            const date = format(dateStr);
            if (date && !isNaN(date.getTime())) {
              return date;
            }
          } catch (e) {
            // Continue to next format
          }
        }
        return null;
      };

      // Sort data series by x-axis values (dates) to ensure chronological order
      const sortedDataSeries = dataSeries.map((series) => ({
        ...series,
        data: [...series.data].sort((a, b) => {
          // Sort by x value (handles both strings and numbers)
          if (typeof a.x === "string" && typeof b.x === "string") {
            const dateA = parseDate(a.x);
            const dateB = parseDate(b.x);

            // If both are valid dates, sort chronologically (earliest first)
            if (dateA && dateB) {
              return dateA.getTime() - dateB.getTime();
            }

            // Fallback to string comparison for non-date strings
            return a.x.localeCompare(b.x);
          }
          return Number(a.x) - Number(b.x);
        }),
      }));

      // Log chart creation details
      console.log("[Chart Creation] Creating chart:", {
        title,
        type,
        xAxisLabel,
        yAxisLabel,
        seriesCount: dataSeries.length,
        totalDataPoints: dataSeries.reduce(
          (sum, series) => sum + series.data.length,
          0
        ),
        seriesNames: dataSeries.map((s) => s.name),
        dataSorted: true,
      });

      // Return structured chart data for the UI to render
      const chartData = {
        chartType: type,
        title,
        xAxisLabel,
        yAxisLabel,
        dataSeries: sortedDataSeries,
        description,
        metadata: {
          totalSeries: dataSeries.length,
          totalDataPoints: dataSeries.reduce(
            (sum, series) => sum + series.data.length,
            0
          ),
          dateRange:
            sortedDataSeries.length > 0 && sortedDataSeries[0].data.length > 0
              ? {
                  start: sortedDataSeries[0].data[0].x,
                  end: sortedDataSeries[0].data[
                    sortedDataSeries[0].data.length - 1
                  ].x,
                }
              : null,
        },
      };

      console.log(
        "[Chart Creation] Chart data size:",
        JSON.stringify(chartData).length,
        "bytes"
      );

      return chartData;
    },
  }),

  codeExecution: tool({
    description: `Execute Python code securely in a Daytona Sandbox for financial modeling, data analysis, and calculations. CRITICAL: Always include print() statements to show results. Daytona can also capture rich artifacts (e.g., charts) when code renders images.

    IMPORTANT INSTRUCTIONS:
    - You can only import standard library utilities (math, statistics, etc.), no external packages.
    - Do **not** under any circumstances attempt to install packages (pip, conda, etc.) or load external files or networks.
    - Keep everything self-contained in plain Python.
    - Your entire code MUST be strictly **under 10,000 characters** (including all whitespace and comments). If your code is too long, shorten or simplify it.

    REQUIRED FORMAT - Your Python code MUST include print statements:
    
    Example for financial calculations:
    # Calculate compound interest
    principal = 10000
    rate = 0.07
    time = 5
    amount = principal * (1 + rate) ** time
    print(f"Initial investment: $\{principal:,.2f}")
    print(f"Annual interest rate: \{rate*100:.1f}%")
    print(f"Time period: \{time} years")
    print(f"Final amount: $\{amount:,.2f}")
    print(f"Interest earned: $\{amount - principal:,.2f}")
    
    Example for data analysis:
    values = [100, 150, 200, 175, 225]
    average = sum(values) / len(values)
    std_dev = (sum((x - average) ** 2 for x in values) / len(values)) ** 0.5
    print(f"Data: \{values}")
    print(f"Average: \{average:.2f}")
    print(f"Standard deviation: \{std_dev:.2f}")
    
    IMPORTANT: 
    - Always end with print() statements showing final results
    - Use descriptive labels and proper formatting
    - Include units, currency symbols, or percentages where appropriate
    - Show intermediate steps for complex calculations`,
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          "Python code to execute - MUST include print() statements to display results. Use descriptive output formatting with labels, units, and proper number formatting."
        ),
      description: z
        .string()
        .optional()
        .describe(
          'Brief description of what the calculation or analysis does (e.g., "Calculate future value with compound interest", "Analyze portfolio risk metrics")'
        ),
    }),
    execute: async ({ code, description }, options) => {
      const userId = (options as any)?.experimental_context?.userId;
      const sessionId = (options as any)?.experimental_context?.sessionId;
      const userTier = (options as any)?.experimental_context?.userTier;
      const isDevelopment = process.env.NEXT_PUBLIC_APP_MODE === "development";
      const requestId = (options as any)?.experimental_context?.requestId;

      const startTime = Date.now();
      const validations: ValidationItem[] = [];

      try {
        console.log("[Code Execution] Executing Python code:", {
          description,
          codeLength: code.length,
          codePreview: code.substring(0, 100) + "...",
        });

        // Check for reasonable code length
        const lengthOk = code.length <= 10000;
        validations.push({
          label: "Code Length",
          status: lengthOk ? "pass" : "fail",
          detail: lengthOk
            ? "Within the 10,000 character limit."
            : "Code exceeds the 10,000 character limit.",
        });
        if (!lengthOk) {
          return `${formatValidationSummary(
            validations
          )}\n\nPlease shorten your code and try again.`;
        }

        // Initialize Daytona client
        const daytonaApiKey = process.env.DAYTONA_API_KEY;
        if (!daytonaApiKey) {
          return "❌ **Configuration Error**: Daytona API key is not configured. Please set DAYTONA_API_KEY in your environment.";
        }

        const daytona = new Daytona({
          apiKey: daytonaApiKey,
          // Optional overrides if provided
          serverUrl: process.env.DAYTONA_API_URL,
          target: (process.env.DAYTONA_TARGET as any) || undefined,
        });

        let sandbox: any | null = null;
        try {
          // Create a Python sandbox
          sandbox = await daytona.create({ language: "python" });

          const importRegex =
            /(^|\s)(?:from\s+[A-Za-z_][A-Za-z0-9_.]*\s+import|import\s+[A-Za-z_][A-Za-z0-9_.]*)/m;
          const hasImports = importRegex.test(code);
          validations.push({
            label: "Import Usage",
            status: hasImports ? "fail" : "pass",
            detail: hasImports
              ? "Import statements detected. The sandbox requires fully self-contained code."
              : "No import statements detected.",
          });
          if (hasImports) {
            return `${formatValidationSummary(
              validations
            )}\n\nRemove the imports and rerun your request.`;
          }

          // Preflight imports to ensure only available modules are used
          const importedModules = extractImportedModules(code);
          const missingModules: string[] = [];

          for (const modName of importedModules) {
            const check = await sandbox.process.codeRun(`import ${modName}`);
            if (check.exitCode !== 0) {
              missingModules.push(modName);
            }
          }

          if (missingModules.length > 0) {
            const uniqueMissing = Array.from(new Set(missingModules));
            const formatted = uniqueMissing.map((m) => `• \`${m}\``).join("\n");
            validations.push({
              label: "Module Availability",
              status: "fail",
              detail: `Attempted to import:\n${formatted}`,
            });
            return `${formatValidationSummary(
              validations
            )}\n\nPlease rewrite your Python code to rely only on built-in modules that are already available (no pip installs).`;
          }
          validations.push({
            label: "Module Availability",
            status: "pass",
            detail: "No external module imports attempted.",
          });

          const aliasIssue = detectCodeIssues(code);
          if (aliasIssue) {
            validations.push(aliasIssue);
            return `${formatValidationSummary(
              validations
            )}\n\nUpdate the code to satisfy the sandbox rules and try again.`;
          }
          validations.push({
            label: "NumPy Alias Safety",
            status: "pass",
            detail: "No unsupported NumPy alias usage detected.",
          });

          const validationSummary = formatValidationSummary(validations);

          // Execute the user's code
          const execution = await sandbox.process.codeRun(code);

          const executionTime = Date.now() - startTime;

          // Track code execution
          await track("Python Code Executed", {
            success: execution.exitCode === 0,
            codeLength: code.length,
            outputLength: execution.result?.length || 0,
            executionTime: executionTime,
            hasDescription: !!description,
            hasError: execution.exitCode !== 0,
            hasArtifacts: !!execution.artifacts,
          });

          // Track usage for pay-per-use customers with Polar events
          if (
            userId &&
            sessionId &&
            userTier === "pay_per_use" &&
            execution.exitCode === 0 &&
            !isDevelopment
          ) {
            try {
              const polarTracker = new PolarEventTracker();

              console.log(
                "[CodeExecution] Tracking Daytona usage with Polar:",
                {
                  userId,
                  sessionId,
                  executionTime,
                }
              );

              await polarTracker.trackDaytonaUsage(
                userId,
                sessionId,
                executionTime,
                {
                  codeLength: code.length,
                  hasArtifacts: !!execution.artifacts,
                  success: execution.exitCode === 0,
                  description: description || "Code execution",
                }
              );
            } catch (error) {
              console.error(
                "[CodeExecution] Failed to track Daytona usage:",
                error
              );
              // Don't fail the tool execution if usage tracking fails
            }
          }

          // Handle execution errors
          if (execution.exitCode !== 0) {
            // Provide helpful error messages for common issues
            let helpfulError = execution.result || "Unknown execution error";
            const missingModule = extractMissingModuleName(helpfulError);
            if (missingModule) {
              helpfulError = `${helpfulError}\n\n🚫 **Unsupported Package**: The Daytona sandbox cannot install external modules like \`${missingModule}\`. Please rewrite your code to use only standard library modules or packages that are already available.`;
            } else if (helpfulError.includes("NameError")) {
              helpfulError = `${helpfulError}\n\n💡 **Tip**: Make sure all variables are defined before use. If you're trying to calculate something, include the full calculation in your code.`;
            } else if (helpfulError.includes("SyntaxError")) {
              helpfulError = `${helpfulError}\n\n💡 **Tip**: Check your Python syntax. Make sure all parentheses, quotes, and indentation are correct.`;
            }

            return `${validationSummary}\n\n❌ **Execution Error**: ${escapeModuleTag(
              helpfulError
            )}`;
          }

          console.log("[Code Execution] Success:", {
            outputLength: execution.result?.length || 0,
            executionTime,
            hasArtifacts: !!execution.artifacts,
          });

          // Format the successful execution result
          return `${validationSummary}\n\n🐍 **Python Code Execution (Daytona Sandbox)**
${description ? `**Description**: ${description}\n` : ""}

\`\`\`python
${code}
\`\`\`

**Output:**
\`\`\`
${escapeModuleTag(execution.result || "(No output produced)")}
\`\`\`

⏱️ **Execution Time**: ${executionTime}ms`;
        } finally {
          // Clean up sandbox
          try {
            if (sandbox) {
              await sandbox.delete();
            }
          } catch (cleanupError) {
            console.error(
              "[CodeExecution] Failed to delete Daytona sandbox:",
              cleanupError
            );
          }
        }
      } catch (error: any) {
        console.error("[CodeExecution] Error:", error);

        return `❌ **Error**: Failed to execute Python code. ${
          error.message || "Unknown error occurred"
        }`;
      }
    },
  }),

  webSearch: tool({
    description:
      "Search the web for general information on any topic using Valyu DeepSearch API with access to both proprietary sources and web content",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Search query for any topic (e.g., "benefits of renewable energy", "latest AI developments", "climate change solutions")'
        ),
    }),
    execute: async ({ query }, options) => {
      const userId = (options as any)?.experimental_context?.userId;
      const sessionId = (options as any)?.experimental_context?.sessionId;
      const userTier = (options as any)?.experimental_context?.userTier;
      const isDevelopment = process.env.NEXT_PUBLIC_APP_MODE === "development";
      const requestId = (options as any)?.experimental_context?.requestId;

      try {
        // Initialize Valyu client (uses default/free tier if no API key)
        const valyu = new Valyu(
          process.env.VALYU_API_KEY,
          "https://api.valyu.network/v1"
        );

        // Configure search options
        const searchOptions = {
          searchType: "all" as const, // Search both proprietary and web sources
        };

        // Use per-session memo + in-flight dedupe
        const sessionKey = buildToolKey("webSearch", query, searchOptions);
        const response = await withSessionMemo(sessionId, sessionKey, () =>
          once(
            "webSearch",
            canonQuery(query),
            canonOptions(searchOptions),
            () => valyu.search(query, searchOptions)
          )
        );

        // Attach canonical id (DOI -> arXiv -> URL) mapped to deterministic UUIDs
        const mapped = (response?.results || []).map((r: any) => {
          const doi = extractDoi(r.url) || extractDoi(r.content);
          const arxiv = extractArxivId(r.url);
          const normalized = normalizeUrl(r.url);
          const key = doi || arxiv || normalized;
          return {
            id: key ? keyToUuid(key) : resultId(r),
            title: r.title || "Web Result",
            url: r.url,
            content: r.content,
            date: r.metadata?.date,
            source: r.metadata?.source,
            dataType: r.data_type,
            length: r.length,
            image_url: r.image_url || {},
            relevance_score: r.relevance_score,
          };
        });

        const unique = dedupeBy(mapped, (x) => x.id);
        const final = dedupeAgainstRequest(requestId, unique, (x) => x.id);

        // Track Valyu web search call
        await track("Valyu API Call", {
          toolType: "webSearch",
          query: query,
          maxResults: 10,
          resultCount: final.length || 0,
          hasApiKey: !!process.env.VALYU_API_KEY,
          cost:
            (response as any)?.metadata?.totalCost ||
            (response as any)?.total_deduction_dollars ||
            null,
          searchTime: (response as any)?.metadata?.searchTime || null,
          txId: (response as any)?.tx_id || null,
        });

        // Track usage for pay-per-use customers with Polar events
        if (
          userId &&
          sessionId &&
          userTier === "pay_per_use" &&
          !isDevelopment
        ) {
          try {
            const polarTracker = new PolarEventTracker();
            // Use the actual Valyu API cost from response
            const valyuCostDollars =
              (response as any)?.total_deduction_dollars || 0;

            console.log("[WebSearch] Tracking Valyu API usage with Polar:", {
              userId,
              sessionId,
              valyuCostDollars,
              resultCount: response?.results?.length || 0,
            });

            await polarTracker.trackValyuAPIUsage(
              userId,
              sessionId,
              "webSearch",
              valyuCostDollars,
              {
                query,
                resultCount: response?.results?.length || 0,
                success: true,
                tx_id: (response as any)?.tx_id,
                search_time: (response as any)?.metadata?.searchTime,
              }
            );
          } catch (error) {
            console.error(
              "[WebSearch] Failed to track Valyu API usage:",
              error
            );
            // Don't fail the search if usage tracking fails
          }
        }

        // Log the full API response for debugging
        console.log(
          "[Web Search] Full API Response:",
          JSON.stringify(response, null, 2)
        );

        if (
          !response ||
          !response.results ||
          response.results.length === 0 ||
          final.length === 0
        ) {
          return `🔍 No web results found for "${query}". Try rephrasing your search with different keywords.`;
        }

        // Log key information about the search
        const metadata = (response as any).metadata;
        console.log("[Web Search] Summary:", {
          query,
          resultCount: final.length,
          totalCost:
            metadata?.totalCost ||
            (response as any).total_deduction_dollars ||
            "N/A",
          searchTime: metadata?.searchTime || "N/A",
          txId: (response as any).tx_id || "N/A",
          firstResultTitle: final[0]?.title,
          firstResultLength: final[0]?.length,
        });

        // Return structured data for the model to process
        const formattedResponse = {
          type: "web_search",
          query: query,
          resultCount: final.length,
          metadata: {
            totalCost: metadata?.totalCost,
            searchTime: metadata?.searchTime,
          },
          results: final.map((result: any) => ({
            id: result.id,
            title: result.title || "Web Result",
            url: result.url,
            content: result.content,
            date: result.date,
            source: result.source,
            dataType: result.dataType,
            length: result.length,
            image_url: result.image_url || {},
            relevance_score: result.relevance_score,
          })),
        };

        console.log(
          "[Web Search] Formatted response size:",
          JSON.stringify(formattedResponse).length,
          "bytes"
        );

        return JSON.stringify(formattedResponse, null, 2);
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes("401") ||
            error.message.includes("unauthorized")
          ) {
            return "🔐 Authentication error with Valyu API. Please check your configuration.";
          }
          if (error.message.includes("429")) {
            return "⏱️ Rate limit exceeded. Please try again in a moment.";
          }
          if (
            error.message.includes("network") ||
            error.message.includes("fetch")
          ) {
            return "🌐 Network error connecting to Valyu API. Please check your internet connection.";
          }
          if (
            error.message.includes("price") ||
            error.message.includes("cost")
          ) {
            return "💰 Search cost exceeded maximum budget. Try reducing maxPrice or using more specific queries.";
          }
        }

        return `❌ Error performing web search: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
      }
    },
  }),
};

// Export with both names for compatibility
export const financeTools = everythingTools;

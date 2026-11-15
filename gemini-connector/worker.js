// Gemini PDF Reader: a tiny Claude connector (MCP server) that runs on Cloudflare Workers.
//
// Your artifacts send it PDF pages (as images, plus any text the PDF already has).
// It asks Gemini to turn them into accurate markdown and sends the markdown back.
// Your Gemini API key lives only in Cloudflare's secret storage, never in an artifact.
//
// Settings in Cloudflare (Worker > Settings > Variables and Secrets):
//   GEMINI_API_KEY   (Secret)  Your key from Google AI Studio.
//   CONNECTOR_TOKEN  (Secret)  A long random password. It becomes part of the connector URL.
//   GEMINI_MODEL     (Text, optional)  Gemini model name. Default below.

const DEFAULT_MODEL = "gemini-2.5-flash";
const SERVER_INFO = { name: "gemini-pdf-reader", version: "1.0.0" };
const MAX_PAGES_PER_CALL = 10;

const CONVERT_PROMPT = `You convert pages of a construction or business document into Markdown.
Rules:
- Transcribe EVERYTHING on each page, word for word. Do not summarize, shorten, reword or skip anything.
- Copy every number, dimension, unit, spec section number, model number, date and dollar amount exactly as printed.
- Keep headings, numbered and lettered lists, and indentation levels.
- Write tables as Markdown tables with every row and column.
- For drawings, diagrams, stamps or images, write a short description in [brackets] plus all readable text and callouts.
- If text is unreadable, write [illegible] instead of guessing.
- Start each page with a line "<!-- page N -->" using the page number you were given.
- When "text layer" is provided for a page, it is the exact text extracted from the PDF. Use it as the source of truth for spelling and numbers, and use the image for layout and anything the text layer is missing.
- Output only the Markdown. No commentary before or after.`;

const TOOLS = [
  {
    name: "convert_pages_to_markdown",
    description:
      "Convert up to 10 PDF pages to accurate, complete Markdown using Gemini. Send each page as a PNG or JPEG image (base64), with the PDF's own text for that page when available.",
    inputSchema: {
      type: "object",
      properties: {
        document_name: { type: "string", description: "File name, for context." },
        pages: {
          type: "array",
          maxItems: MAX_PAGES_PER_CALL,
          items: {
            type: "object",
            properties: {
              page_number: { type: "integer" },
              image_base64: { type: "string", description: "Page image, base64, no data: prefix." },
              mime_type: { type: "string", enum: ["image/png", "image/jpeg", "image/webp"] },
              text_layer: { type: "string", description: "Text extracted from the PDF for this page, if any." },
            },
            required: ["page_number"],
          },
        },
        extra_instructions: { type: "string", description: "Optional extra guidance, e.g. 'this is a door hardware submittal'." },
      },
      required: ["pages"],
    },
  },
];

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Constant-time string compare, so the token can't be guessed by timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function callGemini(env, args) {
  const pages = Array.isArray(args.pages) ? args.pages : [];
  if (pages.length === 0) throw new Error("No pages were sent.");
  if (pages.length > MAX_PAGES_PER_CALL) throw new Error(`Send at most ${MAX_PAGES_PER_CALL} pages per call.`);

  const parts = [{ text: CONVERT_PROMPT }];
  if (args.document_name) parts.push({ text: `Document: ${args.document_name}` });
  if (args.extra_instructions) parts.push({ text: `Extra guidance: ${args.extra_instructions}` });
  for (const p of pages) {
    parts.push({ text: `--- Page ${p.page_number} ---` });
    if (p.text_layer) parts.push({ text: `Text layer for page ${p.page_number}:\n${p.text_layer}` });
    if (p.image_base64) {
      parts.push({ inline_data: { mime_type: p.mime_type || "image/png", data: p.image_base64 } });
    }
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 65536 },
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini refused the request: ${msg}`);
  }
  const cand = data?.candidates?.[0];
  const markdown = (cand?.content?.parts || []).map((x) => x.text || "").join("");
  if (!markdown) throw new Error(`Gemini returned no text (finish reason: ${cand?.finishReason || "unknown"}).`);
  return {
    markdown,
    model,
    finish_reason: cand?.finishReason || null,
    truncated: cand?.finishReason === "MAX_TOKENS",
    input_tokens: data?.usageMetadata?.promptTokenCount ?? null,
    output_tokens: data?.usageMetadata?.candidatesTokenCount ?? null,
  };
}

async function handleRpc(msg, env) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (isNotification) return null; // e.g. notifications/initialized: nothing to answer
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    if (params?.name !== "convert_pages_to_markdown") return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
    try {
      const out = await callGemini(env, params.arguments || {});
      return rpcResult(id, {
        content: [{ type: "text", text: out.markdown }],
        structuredContent: out,
        isError: false,
      });
    } catch (err) {
      return rpcResult(id, { content: [{ type: "text", text: String(err.message || err) }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // expects /mcp/<token>

    if (parts[0] !== "mcp" || !env.CONNECTOR_TOKEN || !safeEqual(parts[1] || "", env.CONNECTOR_TOKEN)) {
      return new Response("Not found", { status: 404 });
    }
    if (!env.GEMINI_API_KEY) return json(rpcError(null, -32000, "GEMINI_API_KEY is not set in Cloudflare."), 500);
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(rpcError(null, -32700, "Request body is not valid JSON."), 400);
    }

    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((m) => handleRpc(m, env)))).filter(Boolean);
      return replies.length ? json(replies) : new Response(null, { status: 202 });
    }
    const reply = await handleRpc(body, env);
    return reply ? json(reply) : new Response(null, { status: 202 });
  },
};

// Tests for gemini-connector/worker.js, with Gemini replaced by a fake so no key or network is needed.
// Run from the project folder with:  node --test
import { test } from "node:test";
import assert from "node:assert";
import worker from "../gemini-connector/worker.js";

const env = { GEMINI_API_KEY: "test-key", CONNECTOR_TOKEN: "s3cret-token-123" };
const URL_OK = "https://x.workers.dev/mcp/s3cret-token-123";

function post(url, body) {
  return worker.fetch(new Request(url, { method: "POST", body: JSON.stringify(body) }), env);
}

let lastGeminiRequest = null;
function fakeGemini(responseBody, status = 200) {
  globalThis.fetch = async (url, init) => {
    lastGeminiRequest = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(responseBody), { status });
  };
}

test("wrong or missing token is rejected", async () => {
  assert.strictEqual((await post("https://x.workers.dev/mcp/wrong", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 404);
  assert.strictEqual((await post("https://x.workers.dev/mcp", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 404);
});

test("initialize and tools/list work", async () => {
  const init = await (await post(URL_OK, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.strictEqual(init.result.serverInfo.name, "gemini-pdf-reader");
  assert.ok(init.result.capabilities.tools);
  const notif = await post(URL_OK, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.strictEqual(notif.status, 202);
  const list = await (await post(URL_OK, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.strictEqual(list.result.tools[0].name, "convert_pages_to_markdown");
});

test("tools/call sends pages to Gemini and returns markdown", async () => {
  fakeGemini({
    candidates: [{ content: { parts: [{ text: "<!-- page 1 -->\n# Section 08 71 00" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 40 },
  });
  const res = await (await post(URL_OK, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "convert_pages_to_markdown", arguments: {
      document_name: "spec.pdf",
      pages: [{ page_number: 1, image_base64: "AAAA", mime_type: "image/png", text_layer: "SECTION 08 71 00" }],
    } },
  })).json();
  assert.strictEqual(res.result.isError, false);
  assert.match(res.result.content[0].text, /08 71 00/);
  assert.strictEqual(res.result.structuredContent.input_tokens, 1200);
  // Key goes in a header, never in the URL
  assert.strictEqual(lastGeminiRequest.init.headers["x-goog-api-key"], "test-key");
  assert.ok(!lastGeminiRequest.url.includes("test-key"));
  const parts = lastGeminiRequest.body.contents[0].parts;
  assert.ok(parts.some((p) => p.inline_data?.data === "AAAA"));
  assert.ok(parts.some((p) => p.text?.includes("SECTION 08 71 00")));
  assert.strictEqual(lastGeminiRequest.body.generationConfig.temperature, 0);
});

test("Gemini errors come back as a readable tool error", async () => {
  fakeGemini({ error: { message: "API key not valid" } }, 400);
  const res = await (await post(URL_OK, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "convert_pages_to_markdown", arguments: { pages: [{ page_number: 1, text_layer: "x" }] } },
  })).json();
  assert.strictEqual(res.result.isError, true);
  assert.match(res.result.content[0].text, /API key not valid/);
});

test("too many pages is refused before calling Gemini", async () => {
  lastGeminiRequest = null;
  const pages = Array.from({ length: 11 }, (_, i) => ({ page_number: i + 1, text_layer: "x" }));
  const res = await (await post(URL_OK, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "convert_pages_to_markdown", arguments: { pages } },
  })).json();
  assert.strictEqual(res.result.isError, true);
  assert.strictEqual(lastGeminiRequest, null);
});

test("truncated output is flagged", async () => {
  fakeGemini({ candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MAX_TOKENS" }] });
  const res = await (await post(URL_OK, {
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "convert_pages_to_markdown", arguments: { pages: [{ page_number: 1, text_layer: "x" }] } },
  })).json();
  assert.strictEqual(res.result.structuredContent.truncated, true);
});

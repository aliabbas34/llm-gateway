import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

const mockConfig = {
  NODE_ENV: "test" as const,
  GROQ_API_KEY: "secret_groq_api_token_12345",
  GROQ_MODEL: "llama-3.3-70b-versatile",
  PORT: 3000,
  HOST: "127.0.0.1",
  MAX_TOKENS: 1024,
  SYSTEM_PROMPT: "You are a helpful assistant.",
};

describe("POST /api/v1/chat/completions - LLM Gateway Test Suite", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp(mockConfig);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // SUCCESSFUL STREAM DISTRIBUTION
  it("should successfully pipe stream chunks downstream with the correct headers", async () => {
    const encoder = new TextEncoder();
    const mockWebStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
          ),
        );
        controller.close();
      },
    });

    const spyFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockWebStream,
    });
    vi.stubGlobal("fetch", spyFetch);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("Hello");
    expect(response.body).toContain("World");
    expect(spyFetch).toHaveBeenCalledTimes(1);
  });

  // ZOD VALIDATION
  it("should fail validation and return 403 when the body is empty or malformed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {}, // Invalid structure matching your preHandler guard
    });

    expect(response.statusCode).toBe(400);
    const parsed: unknown = response.json();
    expect(parsed).toHaveProperty("error");
  });

  // UPSTREAM API ERROR MASKING
  it("should return a sterile 502 message and completely mask the internal GROQ_API_KEY on failure", async () => {
    const spyFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401, // Unauthorized upstream
    });
    vi.stubGlobal("fetch", spyFetch);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        messages: [{ role: "user", content: "Test gateway masking" }],
      },
    });

    expect(response.statusCode).toBe(502);
    const parsedBody: unknown = response.json();
    expect(parsedBody).toEqual({
      error: "Bad Gateway",
      message: "Failed to fetch stream from the upstream ai model.",
    });

    // CRITICAL: Ensure the private API key never leaves the server via error dumps
    expect(response.body).not.toContain(mockConfig.GROQ_API_KEY);
  });

  // CLIENT DISCONNECT LIFE-CYCLE TRACKING
  it("should abort the upstream fetch when the response close handler runs", async () => {
    let abortSignalTriggered = false;

    // Simulate an ongoing stream that only ends after the upstream request is aborted
    let streamController:
      ReadableStreamDefaultController<Uint8Array> | undefined;
    const infiniteStream = new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(
          new TextEncoder().encode('data: {"text": "thinking..."}'),
        );
      },
    });

    let resolveAbort!: () => void;
    const abortReceived = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });

    const spyFetch = vi
      .fn()
      .mockImplementation((_url: RequestInfo | URL, init?: RequestInit) => {
        // Hook directly into the fetch configuration options to detect the abort broadcast
        init?.signal?.addEventListener("abort", () => {
          abortSignalTriggered = true;
          resolveAbort();
          try {
            streamController?.close();
          } catch {
            // The downstream disconnect may already have canceled the stream.
          }
        });
        return Promise.resolve({
          ok: true,
          body: infiniteStream,
        });
      });
    vi.stubGlobal("fetch", spyFetch);

    const listenersBeforeRequest = new WeakMap<object, Set<unknown>>();
    app.addHook("onRequest", async (_request, reply) => {
      listenersBeforeRequest.set(
        reply.raw,
        new Set(reply.raw.listeners("close")),
      );
    });
    app.addHook("onSend", async (_request, reply, payload) => {
      const existingListeners =
        listenersBeforeRequest.get(reply.raw) ?? new Set<unknown>();
      const disconnectHandler = reply.raw
        .listeners("close")
        .find((listener) => !existingListeners.has(listener));

      // Invoke only the route's newly registered handler; emitting "close" would
      // make LightMyRequest destroy the test response itself.
      disconnectHandler?.call(reply.raw);
      return payload;
    });

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [{ role: "user", content: "Stay open" }] },
    });

    await abortReceived;
    expect(spyFetch).toHaveBeenCalled();
    expect(abortSignalTriggered).toBe(true);
  });

  // PHYSICAL NETWORK DROPS / DNS TIMEOUTS
  it("should gracefully handle a sudden network crash or fetch rejection by returning a 502", async () => {
    // Intended Behavior: The network drops completely, fetch throws an error, gateway intercepts it safely
    const spyFetch = vi
      .fn()
      .mockRejectedValue(new Error("Fetch failed unexpectedly"));
    vi.stubGlobal("fetch", spyFetch);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [{ role: "user", content: "Trigger crash" }] },
    });

    expect(response.statusCode).toBe(502);
    const parsedBody: { error: string; message: string } = response.json();
    expect(parsedBody.error).toBe("Bad Gateway");
    expect(parsedBody.message).toContain("Fetch failed unexpectedly");
  });

  // 200 OK WITH EMPTY/NULL PAYLOAD
  it("should return a 502 payload if the upstream server returns 200 OK but an empty body stream", async () => {
    // Intended Behavior: Upstream returns status 200 but sends no text data. Gateway catches it before converting streams.
    const spyFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });
    vi.stubGlobal("fetch", spyFetch);

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        messages: [{ role: "user", content: "Trigger empty stream" }],
      },
    });

    expect(response.statusCode).toBe(502);
    const parsedBody: { error: string; message: string } = response.json();
    expect(parsedBody.error).toBe("Bad Gateway");
    expect(parsedBody.message).toContain(
      "Failed to fetch stream from the upstream ai model.",
    );
  });
});

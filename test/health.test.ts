import type { FastifyInstance } from "fastify";
import { describe, afterEach, beforeEach, it, expect } from "vitest";
import type { ConfigType } from "../src/config.js";
import { buildApp } from "../src/app.js";

describe("GET /healthz", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    const mockConfig: ConfigType = {
      PORT: 3000,
      HOST: "127.0.0.1",
      GROQ_API_KEY: "TEST_API_KEY",
      NODE_ENV: "test",
      GROQ_MODEL: "qwen/qwen3.8-27b",
      MAX_TOKENS: 1024,
      SYSTEM_PROMPT: "",
    };
    app = buildApp(mockConfig);
  });

  afterEach(async () => {
    await app.close();
  });

  it("Should return 200 ok with healthz body", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const body: unknown = response.json();
    expect(body).toEqual({
      status: "ok",
    });
  });
});

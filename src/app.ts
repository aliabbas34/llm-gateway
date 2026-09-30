import fastify from "fastify";
import type { ConfigType } from "./config.js";

export function buildApp(config: ConfigType) {
  const app = fastify({
    logger: config.NODE_ENV !== "test",
  });

  app.get("/healthz", () => {
    return { status: "ok" };
  });

  return app;
}

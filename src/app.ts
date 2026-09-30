import fastify, { FastifyInstance } from "fastify";
import { ConfigType } from "./config.js";

export function buildApp(config: ConfigType) {
  const app: FastifyInstance = fastify({
    logger: config.NODE_ENV !== "test",
  });

  app.get("/healthz", () => {
    return { status: "OK" };
  });

  return app;
}

import fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { type ConfigType } from "./config.js";
import { ZodError, type ZodType } from "zod";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { messageBodySchema, type ChatBody } from "./schemas/chat.js";

interface RequestValidationSchema {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function buildApp(config: ConfigType) {
  const app = fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: 256 * 1024,
  });

  app.get("/healthz", () => {
    return { status: "ok" };
  });

  const verifyRequestBodyHook = (schema: RequestValidationSchema) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (schema.body) {
          request.body = await schema.body.parseAsync(request.body);
        }
        if (schema.query) {
          request.query = await schema.query.parseAsync(request.query);
        }
        if (schema.params) {
          request.params = await schema.params.parseAsync(request.params);
        }
      } catch (error) {
        if (error instanceof ZodError) {
          return reply
            .status(400)
            .send({ error: "invalid_request", issues: error.issues });
        }
        return reply.status(500).send({ error });
      }
    };
  };
  app.post(
    "/v1/chat/completions",
    { preHandler: [verifyRequestBodyHook({ body: messageBodySchema })] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { messages } = request.body as ChatBody;
      const abortController = new AbortController();

      const onDisconnect = () => {
        if (!reply.raw.writableEnded) {
          request.log.warn(
            "Client disconnected prematurely. Aborting upstream response.",
          );
          abortController.abort();
        }
      };

      reply.raw.on("close", onDisconnect);
      try {
        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: config.GROQ_MODEL,
              messages: messages,
              stream: true,
              max_tokens: config.MAX_TOKENS,
              system_prompt: config.SYSTEM_PROMPT,
            }),
            signal: abortController.signal,
          },
        );

        if (!response.ok || !response.body) {
          reply.raw.off("close", onDisconnect);
          request.log.error(
            `Upstream llm request failed with status: ${response.status} ${response.statusText}`,
          );
          await response.body?.cancel(); // Ensure the upstream is properly aborted if it was left partially open.
          return reply.code(502).send({
            error: "Bad Gateway",
            message: "Failed to fetch stream from the upstream ai model.",
          });
        }

        reply.headers({
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        const nodeStream = Readable.fromWeb(
          response.body as NodeReadableStream,
        );
        nodeStream.on("end", () => {
          reply.raw.off("close", onDisconnect);
        });
        return reply.send(nodeStream);
      } catch (error) {
        reply.raw.off("close", onDisconnect);
        if (error instanceof Error && error.name === "AbortError") {
          request.log.info(
            "status-code: 500. Upstream llm request aborted successfully due to client disconnect.",
          );
          return reply.code(502).send({
            error: "Bad Gateway",
            message: "Upstream llm request aborted due to client disconnect.",
          });
        }
        return reply.code(502).send({
          error: "Bad Gateway",
          message:
            error instanceof Error
              ? error.message
              : "An unknown error occurred.",
        });
      }
    },
  );

  return app;
}

// exports a buildApp(config) function that creates the Fastify instance, turns on the logger, and registers GET /healthz. That route returns { "status": "ok" }.
import fastify, { FastifyInstance } from "fastify";
import { ConfigType } from "./config.js";

export function buildApp(config: ConfigType) {
    const app: FastifyInstance = fastify({
        logger: config.NODE_ENV !== 'test'
    });

    app.get('/healthz', ()=> {
        return { status: "OK" };
    });

    return app;
}
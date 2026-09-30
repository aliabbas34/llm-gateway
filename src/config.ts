import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GROQ_API_KEY: z.string().min(10),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export function loadConfig(env = process.env) {
  const parsedEnv = envSchema.parse(env);
  return Object.freeze(parsedEnv);
}

export type ConfigType = z.infer<typeof envSchema>;

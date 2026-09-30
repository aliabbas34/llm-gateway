import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GROQ_API_KEY: z.string(),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const parsedEnv = envSchema.parse(process.env);
export const envConfig = Object.freeze(parsedEnv);

export type ConfigType = z.infer<typeof envSchema>;

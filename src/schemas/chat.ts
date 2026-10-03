import { z } from "zod";

export const messageSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z
        .string()
        .min(1, "content cannot be empty")
        .max(32000, "content is too long"),
    }),
  )
  .nonempty("The array must contain atleast one message object")
  .max(100, "Messages length exceeded.");
export const messageBodySchema = z.object({
  messages: messageSchema,
});
export type ChatBody = z.infer<typeof messageBodySchema>;

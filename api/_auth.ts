import type { Context, Next } from "hono";

export async function requireApiKey(c: Context, next: Next) {
  const key = c.req.header("x-api-key");
  if (!key || key !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
}

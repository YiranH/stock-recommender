import { serve } from "@hono/node-server";
import { app } from "./index.js";
import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

// Load environment variables (prefer .env.local, fallback to .env)
if (existsSync(".env.local")) {
  loadEnv({ path: ".env.local" });
} else if (existsSync(".env")) {
  loadEnv();
}

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port
});

// eslint-disable-next-line no-console
console.log(`Local server running on http://localhost:${port}`);


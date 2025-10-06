import { Hono } from "hono";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { RecommendBody, Recommendation } from "../../schemas/portfolio.js";
import { requireApiKey } from "../_auth.js";

const app = new Hono();

app.use("*", requireApiKey);

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = RecommendBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.flatten() }, 400);
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return c.json({ error: "Missing LLM credentials" }, 500);
  }

  try {
    const model = google("gemini-2.5-flash", {
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
    });

    const { object } = await generateObject({
      model,
      schema: Recommendation,
      system:
        "You are a portfolio recommender. Output a diversified portfolio whose weights sum to 100. Prefer liquid, low-fee ETFs unless the user insists on single stocks.",
      prompt: `Objective: ${parsed.data.objective}\nRisk: ${parsed.data.risk_tolerance}\nHorizon (years): ${parsed.data.horizon_years}\nConstraints: ${JSON.stringify(parsed.data.constraints || {})}`
    });

    return c.json(object, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error from LLM";
    return c.json({ error: "Failed to generate recommendation", message }, 502);
  }
});

export const GET = app.fetch;
export const POST = app.fetch;
export default app;

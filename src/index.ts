import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { handle } from "hono/vercel";

import { requireApiKey } from "./middleware/require-api-key.js";
import { RecommendBody, Recommendation } from "../schemas/portfolio.js";

const app = new Hono();

app.use("/v1/*", requireApiKey);

app.post("/v1/recommend", async (c) => {
  const body = await c.req.json();
  const parsed = RecommendBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      400
    );
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return c.json({ error: "Missing LLM credentials" }, 500);
  }

  try {
    const googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
    });

    const model = googleProvider("gemini-2.5-flash") as unknown as LanguageModel;

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

const docs = new OpenAPIHono();

const recommendRoute = createRoute({
  method: "post",
  path: "/v1/recommend",
  request: {
    body: {
      content: {
        "application/json": { schema: RecommendBody }
      }
    }
  },
  responses: {
    200: {
      description: "Portfolio recommendation",
      content: {
        "application/json": { schema: Recommendation }
      }
    },
    400: { description: "Validation error" },
    401: { description: "Unauthorized" },
    500: { description: "Missing LLM credentials" },
    502: { description: "LLM provider error" }
  },
  security: [{ ApiKeyAuth: [] }]
});

docs.openAPIRegistry.registerPath(recommendRoute);

docs.doc("/openapi.json", (c) => ({
  openapi: "3.1.0",
  info: { title: "Portfolio Recommender API", version: "1.0.0" },
  servers: [{ url: new URL(c.req.url).origin }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key"
      }
    }
  }
}));

docs.get("/docs", swaggerUI({ url: "/openapi.json" }));

app.route("/", docs);

export const config = {
  runtime: "nodejs"
};

export default handle(app);
export { app };

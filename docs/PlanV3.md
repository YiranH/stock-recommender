
# Portfolio Recommender API — Plan V3 (Vercel-ready)
_Last updated: 2025-10-05 23:09:00_

This update optimizes for **Vercel** deployment, switches LLM integration to the **Vercel AI SDK** with **Google Gemini** (free-tier friendly), simplifies **auth** to a single static API key, and still exposes **OpenAPI (`/openapi.json`)** + **Swagger UI (`/docs`)**.

> Opinionated choice: **Hono** as a minimal API framework. It deploys to Vercel with **zero config** and works great with Zod + Swagger. (We can also do the same with Next.js Route Handlers if you prefer.)

---

## A. Why this stack?

- **Hono on Vercel** → tiny, fast, zero-config backend that maps routes to Vercel Functions.  
- **Vercel AI SDK** → one unified API for LLMs, with an official **Google provider** so you can use **Gemini** with your **Google API key** (AI Studio free tier).  
- **Zod + `@hono/zod-openapi`** → one source of truth for request/response validation **and** OpenAPI generation.  
- **`@hono/swagger-ui`** → ships a pre-bundled Swagger UI; no asset/CSS headaches on Vercel.

---

## B. Environment & minimal dependencies

**.env** (Vercel → Project → Settings → Environment Variables)
```
API_KEY=replace-with-a-strong-random-value
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key   # from Google AI Studio
RATE_LIMIT_RPM=60
```

**package.json (excerpt)**
```json
{
  "type": "module",
  "scripts": {
    "dev": "vc dev",
    "build": "echo 'Vercel builds functions per file; no bundling needed'",
    "start": "vc dev"
  },
  "dependencies": {
    "hono": "^4.8.0",
    "@hono/zod-openapi": "^0.16.0",
    "@hono/swagger-ui": "^0.4.0",
    "zod": "^3.23.8",
    "ai": "^5.0.0",
    "@ai-sdk/google": "^1.0.0"
  }
}
```

> Vercel CLI (`vc`) is optional but handy for local dev. Node runtime is default on Vercel functions.

---

## C. Folder layout (API-only)

```
/src
  /openapi.ts         # OpenAPI + Swagger routes (/openapi.json, /docs)
  /v1
    /recommend.ts     # POST /v1/recommend (auth + LLM call)
/schemas
  portfolio.ts        # zod schemas for input/output
```

> Each file under `/src` becomes a Vercel Function. Default runtime: Node.js.

---

## D. Schemas

### Request body fields (plain English)

- `objective` (string) — Trimmed, 3–160 characters describing what you’re trying to achieve. Examples: "long-term growth", "preserve capital", "income".
- `risk_tolerance` (`low | medium | high`, default `medium`) — How comfortable you are with market ups and downs.
  - `low` → steadier ride, more bonds/cash, broad ETFs.
  - `medium` → balanced mix of stocks/bonds.
  - `high` → more stocks/tech tilt, bigger drawdowns acceptable.
- `horizon_years` (integer, default `5`) — 1–50 years you expect to keep the money invested before needing it.
  - Short (1–3 yrs) → safer mix, more bonds/cash.
  - Medium (4–10 yrs) → balanced.
  - Long (10+ yrs) → more equities OK.
- `constraints` (object, optional) — Rules the recommender must respect.
  - `constraints.exclude` (string[]) — 1–20 trimmed entries to avoid (tickers or themes). Examples: `["crypto", "TSLA", "energy"]`.
  - `constraints.max_single_weight` (number) — 1–100 cap for any single position as a percent of the portfolio. Example: `35` → no holding above 35% weight.

```ts
// /schemas/portfolio.ts
import { z } from "zod";

export const Position = z
  .object({
    symbol: z.string(),
    name: z.string(),
    asset_class: z.enum(["ETF","Stock","Bond","Cash","Other"]),
    weight: z.number().min(0).max(100),
    rationale: z.string().max(600)
  })
  .strict();

const RecommendConstraints = z
  .object({
    exclude: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Constraint entries cannot be empty")
          .max(60, "Constraint entries should be short")
      )
      .min(1)
      .max(20)
      .describe("Tickers or themes to avoid")
      .optional(),
    max_single_weight: z
      .number()
      .min(1)
      .max(100)
      .describe(
        "Cap any single holding at a percentage of the total portfolio"
      )
      .optional()
  })
  .strict();

const RiskTolerance = z
  .enum(["low","medium","high"])
  .describe("How much volatility the investor can stomach");

const HorizonYears = z
  .number()
  .int()
  .min(1)
  .max(50)
  .describe("Investment horizon in years");

export const RecommendBody = z
  .object({
    objective: z
      .string()
      .trim()
      .min(3)
      .max(160)
      .describe("User's investment objective"),
    risk_tolerance: RiskTolerance.default("medium"),
    horizon_years: HorizonYears.default(5),
    constraints: RecommendConstraints.describe("Optional portfolio rules").optional()
  })
  .strict();

export const Recommendation = z.object({
  version: z.literal("1"),
  objective: z.string(),
  risk_tolerance: z.enum(["low","medium","high"]),
  horizon_years: z.number().int().min(1).max(50),
  constraints: z.object({
    exclude: z.array(z.string()).default([]),
    max_single_weight: z.number().default(40)
  }).partial().default({}),
  portfolio: z.array(Position),
  notes: z.array(z.string()).default([]),
  disclaimers: z.array(z.string()).default([
    "This is not financial advice. Do your own research."
  ])
}).refine(x => Math.round(x.portfolio.reduce((s,p)=>s+p.weight,0)) === 100, {
  message: "Weights must sum to ~100"
});

export type RecommendationT = z.infer<typeof Recommendation>;
```

---

## E. Simple auth (single API key)

- The API expects header: **`x-api-key: <value>`**
- Compares against `process.env.API_KEY` (no DB yet).
- (Optional) Add primitive per-tenant rate limits later.

```ts
// /api/_auth.ts (helper)
import type { Context, Next } from "hono";

export async function requireApiKey(c: Context, next: Next) {
  const key = c.req.header("x-api-key");
  if (!key || key !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
}
```

---

## F. LLM via Vercel AI SDK + Gemini (free tier)

This uses the **official Google provider** so calls go to **Gemini** using your **`GOOGLE_GENERATIVE_AI_API_KEY`**. We also use `generateObject()` so the model is **forced to return structured JSON** matching our Zod schema.

```ts
// /api/v1/recommend.ts
import { Hono } from "hono";
import { z } from "zod";
import { RecommendBody, Recommendation } from "../../schemas/portfolio.js";
import { requireApiKey } from "../_auth.js";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";

const app = new Hono();

app.use("*", requireApiKey);

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = RecommendBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.flatten() }, 400);
  }

  const model = google("gemini-2.5-flash", {
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
  });

  const { object, warnings } = await generateObject({
    model,
    schema: Recommendation,
    system: "You are a portfolio recommender. Output a diversified portfolio whose weights sum to 100. Prefer liquid, low-fee ETFs unless the user insists on single stocks.",
    prompt: `Objective: ${parsed.data.objective}
Risk: ${parsed.data.risk_tolerance}
Horizon (years): ${parsed.data.horizon_years}
Constraints: ${JSON.stringify(parsed.data.constraints || {})}`
  });

  // Optionally check or log warnings from the model/tooling
  return c.json(object, 200);
});

export const GET = app.fetch;
export const POST = app.fetch;
export default app;
```

> If you ever switch to a different provider (e.g., OpenAI, Anthropic, etc.), only the `model = ...` line changes. The schema + `generateObject` stay the same.

---

## G. OpenAPI + Swagger (served from Node runtime)

We generate OpenAPI from Zod schemas and serve `/openapi.json` plus `/docs` (Swagger UI).

```ts
// /api/openapi.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { RecommendBody, Recommendation } from "../schemas/portfolio.js";
import { requireApiKey } from "./_auth.js";

const app = new OpenAPIHono();

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
    401: { description: "Unauthorized" }
  },
  security: [{ BearerAuth: [] }] // For docs only; we actually use x-api-key
});

// Document meta
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Portfolio Recommender API", version: "1.0.0" },
  servers: [{ url: "https://your-project.vercel.app" }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer" }
    }
  }
});

// Connect the documented route (auth not enforced on spec itself)
app.openapi(recommendRoute, async (c) => c.text("see /v1/recommend"));

// Swagger UI
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export const GET = app.fetch;
export const POST = app.fetch;
export default app;
```

> We keep `/openapi.json` public for tooling. If you want to hide it, wrap in `requireApiKey` or gate `/docs` only.

---

## H. CORS, rate limits (optional) & errors

- **CORS**: If you’ll call from a browser, restrict to your frontend origins.
- **Rate limit**: For free-tier safety, add a simple in-memory RPM limiter per `x-api-key` or adopt Vercel’s Firewall Rate Limiting later.
- **Errors**: Return minimal messages. Never leak provider errors directly.

```ts
// simple CORS example (optional)
import { cors } from "hono/cors";
app.use("/*", cors({ origin: ["https://your-frontend.vercel.app","http://localhost:3000"] }));
```

---

## I. Example request

```bash
curl -X POST https://your-project.vercel.app/v1/recommend   -H "x-api-key: $API_KEY"   -H "content-type: application/json"   -d '{"objective":"growth with moderate volatility","risk_tolerance":"medium","horizon_years":7,"constraints":{"exclude":["crypto"],"max_single_weight":35}}'
```

---

## J. Next.js Route Handlers alternative (if you prefer Next)

If you want to *skip Hono* and go pure Next.js, this is equivalent:

```
src/
  api/
    v1/
      recommend/
        route.ts         // POST handler with generateObject()
    openapi/
      route.ts           // serve JSON
    docs/
      route.ts           // serve Swagger UI HTML
```

- Use the same schemas & `generateObject` call.  
- In `/src/api/openapi/route.ts`, generate the spec from your Zod schemas using `@asteasolutions/zod-to-openapi` and return JSON.  
- For `/src/api/docs/route.ts`, embed Swagger UI HTML (or use Scalar/Redoc).  
- Add a simple `x-api-key` check at the top of each route.

---

## K. Deploy steps

1) Create Vercel project → import repo.  
2) Add env vars: `API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.  
3) `git push` → Vercel builds and deploys.  
4) Visit `/docs` (Swagger UI) and try POST `/v1/recommend` with **x-api-key**.

---

## L. Roadmap (later)

- Switch auth to **per-tenant API keys** (KV/SQLite/Edge Config) + per-key rate limit.
- Add `/v1/validate` and `/v1/explain` endpoints.
- Stream responses with `streamObject()` for progressive UIs.
- Add `/openapi.yaml` and publish a typed SDK via Speakeasy/OpenAPI TS.

---

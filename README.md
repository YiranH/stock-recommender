# Portfolio Recommender API

Minimal Hono-based API that uses the Vercel AI SDK with Google Gemini to produce diversified stock/ETF portfolios from user goals. Ready for Vercel deployment and ships with OpenAPI and Swagger UI endpoints.

## Prerequisites

- Node.js 20+
- pnpm 9 (run `corepack enable pnpm` if not already enabled)
- Google AI Studio API key for Gemini (free tier works)
- (Optional) Vercel CLI `vc` for local dev parity with Vercel Functions

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy `.env.example` to `.env.local` (or `.env`) and fill in:
   ```bash
   cp .env.example .env.local
   ```
   Required values:
   - `API_KEY` — static token expected in the `x-api-key` header
   - `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini API key from Google AI Studio
   - `RATE_LIMIT_RPM` — optional; currently unused but reserved for rate limiting
3. If you plan to run `pnpm dev`, install the Vercel CLI globally:
   ```bash
   pnpm add -g vercel
   ```

## Local Development

Run the development server (uses `vc dev` under the hood):
```bash
pnpm dev
```
Requests are served from `http://localhost:3000` by default.

### Linting / Typecheck
```bash
pnpm lint
```

## API

### POST /v1/recommend

- Headers: `x-api-key: <API_KEY>`
- Body (JSON):
  ```json
  {
    "objective": "growth with moderate volatility",
    "risk_tolerance": "medium",
    "horizon_years": 7,
    "constraints": {
      "exclude": ["crypto"],
      "max_single_weight": 35
    }
  }
  ```
- Response: Structured portfolio matching the schema in `schemas/portfolio.ts`.

### Docs & Spec

- `GET /openapi.json` — OpenAPI 3.1 spec
- `GET /docs` — Swagger UI served via `@hono/swagger-ui`

## Deployment (Vercel)

1. Create a new Vercel project and link this repository.
2. Add the environment variables from `.env.local` in the Vercel dashboard.
3. Push to the default branch; Vercel builds and deploys automatically.
4. Test the live endpoint:
   ```bash
   curl -X POST https://<your-project>.vercel.app/v1/recommend \
     -H "content-type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d '{"objective":"growth","risk_tolerance":"medium","horizon_years":5}'
   ```

## Project Structure

```
api/
  _auth.ts           // x-api-key middleware
  openapi.ts         // OpenAPI spec + Swagger UI
  v1/recommend.ts    // LLM-backed portfolio recommendation endpoint
schemas/
  portfolio.ts       // Shared Zod schemas for request/response
```

## Troubleshooting

- **401 Unauthorized**: Check the `x-api-key` header and `API_KEY` env var.
- **500 Missing LLM credentials**: Ensure `GOOGLE_GENERATIVE_AI_API_KEY` is set locally or on Vercel.
- **502 Failed to generate recommendation**: Gemini request failed; verify quota and API key validity.

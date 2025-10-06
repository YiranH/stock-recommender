**Don't use this. It's outdated**

Build an api endpoint to recommend stocks based on user input. 
Tech stack: TypeScript + Hono (micro HTTP framework) + Vercel AI SDK. 

⸻

v1 Goal

One endpoint:

POST /v1/recommend
Input: free-form text describing goals
Output: a portfolio outline (weights + sectors) and per-pick reasons you can render in any UI.

Universe: S&P 500 only.
No DB, no tests, minimal caching.
Deterministic ranking lives outside the model. LLM only parses preferences + writes explanations.

⸻

Architecture (small & sharp)
	•	HTTP: Hono (api/server.ts) → deploy anywhere (Vercel, Fly, local).
	•	LLM: Vercel AI SDK:
	•	generateObject — turn text → preference JSON
	•	streamText (or generateText) — write explanations/rationales
	•	Data:
	•	data/sp500.json — constituents (vendored)
	•	Quotes & a few fundamentals from yahoo-finance2 (Node)
	•	In-memory + optional file cache (.cache/*.json) with TTL 24h
	•	Deterministic core (pure TS): computeFeatures, rankCandidates, constructPortfolio

⸻

API Contract

Request

{
  "query": "I want dividend income with low volatility, avoid energy, top 10 names.",
  "options": {
    "top_k": 12,
    "allow_llm_rerank": true,
    "demo_mode": false
  }
}

	•	top_k default 12 (clamped 5–20)
	•	allow_llm_rerank (±10% cap)
	•	demo_mode: if true, skip live fetch and use cached sample factors

Response (outline)

{
  "run_id": "2025-10-05T22:14:12Z-abc123",
  "preferences": { ...normalized weights & constraints... },
  "portfolio_outline": {
    "strategy": "Quality + stability with dividend tilt",
    "target_positions": [
      {"ticker":"PG","weight":0.08},
      {"ticker":"KO","weight":0.08},
      {"ticker":"PEP","weight":0.08},
      ...
    ],
    "sector_exposure": [
      {"sector":"Consumer Staples","weight":0.32},
      {"sector":"Health Care","weight":0.22},
      ...
    ],
    "notes": ["Max position 6%", "Sector cap 25%", "Vol cap 30% (90d)"]
  },
  "picks": [
    {
      "ticker": "PG",
      "fit": ["Low realized vol; consistent margins", "Dividend yield within target"],
      "risks": ["Fx exposure; input cost pressure"],
      "data_points": {"momentum":0.62,"quality":0.78,"value":0.41,"stability":0.83,"dividend":0.66},
      "llm_nudge": 0.06,
      "citations": [
        {"source":"Company IR","date":"2025-08-01","title":"Raised dividend...", "url":"..."},
        {"source":"WSJ","date":"2025-09-10","title":"Staples outperform in drawdowns", "url":"..."}
      ]
    }
  ],
  "limits_applied": {"max_position":0.06,"max_sector":0.25},
  "telemetry": {"candidates":480,"features_missing":12,"live_fetch":"partial"}
}


⸻

Pipeline (single request)
	1.	Parse preferences (LLM; structured output)
	•	Input: query string
	•	Output JSON (weights + constraints):
	•	factor_weights: momentum, quality, value, stability, dividend, growth (sum → 1.0)
	•	constraints: max_position, max_sector, max_vol_90d, min_div_yield, sector_exclude, etc.
	•	Clamp and sanitize; if empty, default to a balanced template.
	2.	Candidate set (S&P 500)
	•	Load sp500.json (symbol, name, sector)
	3.	Data fetch (cheap & batched)
	•	Quotes (adj close ~400 trading days) via yahoo-finance2 in 3–5 batches
	•	Fundamentals (best-effort): trailingPE, priceToSales, enterpriseToEbitda, grossMargins, returnOnAssets, dividendYield, payoutRatio
	•	If demo_mode, skip fetch and load data/sample_features.json
	4.	Feature compute (pure TS)
	•	Momentum: 6m & 12m total returns (optionally 12–1)
	•	Stability: 90d realized vol; 1y max drawdown
	•	Value: blended z of PE / EVEBITDA / PS (winsorized)
	•	Quality: ROA + gross margin blend
	•	Dividend: trailing yield & payout (penalize > 70%)
	•	Normalize → z → [0,1] for UI friendliness
	5.	Base ranking (pure TS)
	•	score = sum(w_f * S_f) - λ * penalties
	•	Penalties: sector crowding pressure, vol above cap, payout too high, missing data
	•	Sort descending, keep top K_base = top_k * 2 for rerank
	6.	(Optional) LLM rerank ±10%
	•	For each of the top K_base, fetch up to 3 headlines (title/date/url)
	•	Give LLM only features + headlines; it returns delta ∈ [-0.1, +0.1] and 3 bullets (fit/risks/evidence)
	•	Recompute score' = score * (1 + delta)
	7.	Portfolio outline (pure TS)
	•	Take final top_k; equal weight or inverse-vol tweak
	•	Enforce max_position and max_sector (greedy clamp + renorm)
	•	Aggregate sector exposure
	•	Build outline strings (“Quality + stability with dividend tilt”)
	8.	Assemble response
	•	Include preferences, portfolio_outline, picks[] with bullets, telemetry, limits_applied
	•	No charts in v1; your UI can add them later

⸻

Prompts (tight & safe)

A) Preference parser (structured output via generateObject)

System:
“You convert a human request into investment preferences for an S&P 500 stock screener. Output strictly valid JSON to this schema (weights must sum to 1.0; clamp values to ranges). Do not recommend tickers.”

Output schema:

{
  objective: "income" | "growth" | "balanced" | "alpha",
  risk_tolerance: "low" | "medium" | "high",
  horizon_months: number,
  factor_weights: Record<"momentum"|"quality"|"value"|"stability"|"dividend"|"growth", number>,
  constraints: {
    max_position?: number, max_sector?: number, max_vol_90d?: number,
    min_div_yield?: number, sector_exclude?: string[], sector_whitelist?: string[]
  }
}

B) Rerank & rationale (text or object)

System:
“You are a cautious research editor. For each stock, you may adjust the base score by at most ±10% only if justified by the provided headlines. Produce: delta in [-0.10, 0.10], and three concise bullets: Fit, Risks, Evidence (with source+date). Never invent numbers, never mention tools.”

⸻

Modules & files

api/
  server.ts                # Hono app, defines POST /v1/recommend
  llm/
    models.ts              # AI SDK setup (provider, model)
    prefs.ts               # generateObject() wrapper
    rerank.ts              # (optional) explanations + deltas
  data/
    sp500.json             # constituents
    cache.ts               # in-memory + file cache (TTL 24h)
  fetch/
    quotes.ts              # yahoo-finance2 batch get (adj close)
    fundamentals.ts        # yahoo-finance2 summary/fundamentals
    news.ts                # yahoo-finance2 news/headlines (or placeholder)
  rank/
    features.ts            # momentum/vol/dd/value/quality/dividend
    scorer.ts              # score + penalties
    portfolio.ts           # weights + sector caps
  util/
    normalize.ts           # z-scores, winsorize, guards
    types.ts               # shared TS types/schemas
data/
  sp500.json
  sample_features.json     # demo mode fallback
.cache/                    # gitignored JSON snapshots


⸻

Implementation steps (you can build straight down this list)

M1 — Skeleton (≈1–2 hrs)
	•	Hono server + POST /v1/recommend
	•	Wire AI SDK (env: AI_MODEL, AI_API_KEY)

M2 — Preferences (≈1 hr)
	•	prefs.parse(query) → validated weights/constraints (defaults if missing)

M3 — Constituents & fetch (≈2–3 hrs)
	•	Load sp500.json
	•	Quotes: 480–505 names in 3–5 batches; cache file with timestamp
	•	Fundamentals: best-effort; skip on error; mark “partial”

M4 — Features & base score (≈2–3 hrs)
	•	Implement features; normalize; penalties; base sort
	•	Return top-k without LLM rerank to validate output shape

M5 — Rerank + reasons (optional, ≈2 hrs)
	•	Fetch 3 headlines per top candidate (or stub)
	•	rerank.explain(features, headlines) → delta + bullets
	•	Apply deltas (±10%), resort

M6 — Portfolio outline & response (≈1 hr)
	•	Equal weight → clamp to max_position; enforce max_sector
	•	Assemble JSON (portfolio_outline + picks with bullets + telemetry)

M7 — Polish (≈1 hr)
	•	Input clamps, error messages, demo_mode, telemetry counters
	•	Clear disclaimer in a disclaimer field

⸻

Guardrails
	•	Determinism: ranking math is pure TS; LLM only parses/explains.
	•	Bounds: enforce weight sum=1; deltas ±10%; cap tool calls (quotes/fundamentals/news).
	•	Fallbacks: missing fundamentals → neutralize affected factor; add partial_data: true on pick.
	•	Performance: limit universe to S&P 500; cache 24h; batch requests.

⸻

Example “good” response (shortened)

{
  "run_id": "2025-10-05T22:14:12Z-abc123",
  "preferences": {
    "objective":"income",
    "risk_tolerance":"low",
    "horizon_months":24,
    "factor_weights":{"momentum":0.15,"quality":0.3,"value":0.15,"stability":0.25,"dividend":0.15,"growth":0.0},
    "constraints":{"max_position":0.06,"max_sector":0.25,"max_vol_90d":0.30,"min_div_yield":0.02,"sector_exclude":["Energy"]}
  },
  "portfolio_outline": {
    "strategy":"Quality + stability with dividend tilt",
    "target_positions":[
      {"ticker":"PG","weight":0.06},{"ticker":"KO","weight":0.06},{"ticker":"PEP","weight":0.06},
      {"ticker":"JNJ","weight":0.06},{"ticker":"ABBV","weight":0.06},{"ticker":"MDT","weight":0.06},
      {"ticker":"MSFT","weight":0.06},{"ticker":"COST","weight":0.06},{"ticker":"WMT","weight":0.06},{"ticker":"TXN","weight":0.06},
      {"ticker":"CL","weight":0.05},{"ticker":"SO","weight":0.05}
    ],
    "sector_exposure":[{"sector":"Consumer Staples","weight":0.32},{"sector":"Health Care","weight":0.23},{"sector":"Info Tech","weight":0.18},{"sector":"Utilities","weight":0.05}],
    "notes":["Vol cap 30% (90d)","Dividend ≥ 2%","Sector cap 25%"]
  },
  "picks":[
    {"ticker":"PG","fit":["Low realized vol","Dividend yield ~ target","High margin stability"],"risks":["Fx & input cost sensitivity"],"data_points":{"momentum":0.62,"quality":0.78,"value":0.41,"stability":0.83,"dividend":0.66},"llm_nudge":0.06,"citations":[{"source":"Company IR","date":"2025-08-01","title":"Dividend increase","url":"..."},{"source":"WSJ","date":"2025-09-10","title":"Staples lead in downturns","url":"..."}]},
    {"ticker":"KO","fit":["Stable cash flows","Dividend safety good"],"risks":["Volume softness risk"],"data_points":{"momentum":0.55,"quality":0.71,"value":0.44,"stability":0.79,"dividend":0.69},"llm_nudge":0.04,"citations":[]}
  ],
  "limits_applied":{"max_position":0.06,"max_sector":0.25},
  "telemetry":{"candidates":485,"features_missing":14,"live_fetch":"partial"},
  "disclaimer":"Educational research only. Not investment advice."
}

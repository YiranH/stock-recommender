import { z } from "zod";

export const Position = z.object({
  symbol: z.string(),
  name: z.string(),
  asset_class: z.enum(["ETF", "Stock", "Bond", "Cash", "Other"]),
  weight: z.number().min(0).max(100),
  rationale: z.string().max(600)
});

export const RecommendBody = z.object({
  objective: z.string().describe("User's investment objective"),
  risk_tolerance: z.enum(["low", "medium", "high"]).default("medium"),
  horizon_years: z.number().int().min(1).max(50).default(5),
  constraints: z
    .object({
      exclude: z.array(z.string()).optional(),
      max_single_weight: z.number().optional()
    })
    .optional()
});

export const Recommendation = z
  .object({
    version: z.literal("1"),
    objective: z.string(),
    risk_tolerance: z.enum(["low", "medium", "high"]),
    horizon_years: z.number().int().min(1).max(50),
    constraints: z
      .object({
        exclude: z.array(z.string()).default([]),
        max_single_weight: z.number().default(40)
      })
      .partial()
      .default({}),
    portfolio: z.array(Position),
    notes: z.array(z.string()).default([]),
    disclaimers: z
      .array(z.string())
      .default(["This is not financial advice. Do your own research."])
  })
  .refine(
    (data) =>
      Math.round(
        data.portfolio.reduce((sum, position) => sum + position.weight, 0)
      ) === 100,
    {
      message: "Weights must sum to ~100"
    }
  );

export type RecommendationT = z.infer<typeof Recommendation>;

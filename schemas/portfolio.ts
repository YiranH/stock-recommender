import { z } from "zod";

export const Position = z
  .object({
    symbol: z.string(),
    name: z.string(),
    asset_class: z.enum(["ETF", "Stock", "Bond", "Cash", "Other"]),
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
  .enum(["low", "medium", "high"])
  .describe("How comfortable the investor is with market ups and downs");

const HorizonYears = z
  .number()
  .int()
  .min(1)
  .max(50)
  .describe("Years the investor plans to stay invested before needing the money");

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

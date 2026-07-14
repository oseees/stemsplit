import type { PlanTier } from "@/types/database";

export interface PlanDef {
  tier: PlanTier;
  name: string;
  price: string;
  priceId?: string; // Stripe price id (env-driven)
  uploadsPerMonth: number; // Infinity for unlimited
  features: string[];
  limits: {
    aiNarration: boolean;
    viralIntelligence: boolean;
    competitorAnalysis: boolean;
    teamAccounts: boolean;
    bulkProcessing: boolean;
    priorityProcessing: boolean;
  };
}

export const PLANS: Record<PlanTier, PlanDef> = {
  free: {
    tier: "free",
    name: "Free",
    price: "$0",
    uploadsPerMonth: 5,
    features: ["5 uploads / month", "Basic AI analysis", "Clip detection"],
    limits: {
      aiNarration: false,
      viralIntelligence: false,
      competitorAnalysis: false,
      teamAccounts: false,
      bulkProcessing: false,
      priorityProcessing: false,
    },
  },
  pro: {
    tier: "pro",
    name: "Pro",
    price: "$29/mo",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO,
    uploadsPerMonth: Infinity,
    features: [
      "Unlimited uploads",
      "AI narration",
      "Viral intelligence engine",
      "Competitor analysis",
      "Retention analyzer",
    ],
    limits: {
      aiNarration: true,
      viralIntelligence: true,
      competitorAnalysis: true,
      teamAccounts: false,
      bulkProcessing: false,
      priorityProcessing: false,
    },
  },
  agency: {
    tier: "agency",
    name: "Agency",
    price: "$99/mo",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY,
    uploadsPerMonth: Infinity,
    features: [
      "Everything in Pro",
      "Team accounts",
      "Bulk processing",
      "Priority processing",
    ],
    limits: {
      aiNarration: true,
      viralIntelligence: true,
      competitorAnalysis: true,
      teamAccounts: true,
      bulkProcessing: true,
      priorityProcessing: true,
    },
  },
};

export function planFor(tier: PlanTier | undefined | null): PlanDef {
  return PLANS[tier ?? "free"] ?? PLANS.free;
}

// Maps a Stripe price id back to a tier (used by the webhook).
export function tierForPriceId(priceId: string | undefined): PlanTier {
  if (!priceId) return "free";
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY) return "agency";
  if (priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO) return "pro";
  return "free";
}

export type FeatureKey = keyof PlanDef["limits"];

export function hasFeature(tier: PlanTier | null | undefined, feature: FeatureKey): boolean {
  return planFor(tier).limits[feature];
}

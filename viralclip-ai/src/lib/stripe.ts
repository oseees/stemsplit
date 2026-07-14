import Stripe from "stripe";

// Placeholder fallback keeps module import safe at build time; real calls
// fail clearly at runtime if the key is actually missing.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_placeholder", {
  // Pin to the SDK's expected version to keep types in sync across upgrades.
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});

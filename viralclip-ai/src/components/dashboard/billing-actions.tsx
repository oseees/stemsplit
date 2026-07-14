"use client";

import { useState } from "react";

export function UpgradeButton({
  priceId,
  label,
  variant = "primary",
}: {
  priceId?: string;
  label: string;
  variant?: "primary" | "ghost";
}) {
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!priceId) return alert("This plan's Stripe price id isn't configured yet.");
    setLoading(true);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.url) location.href = data.url;
    else alert(data.error ?? "Could not start checkout");
  }

  return (
    <button
      onClick={go}
      disabled={loading}
      className={`${variant === "primary" ? "btn-primary" : "btn-ghost"} w-full`}
    >
      {loading ? "…" : label}
    </button>
  );
}

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (data.url) location.href = data.url;
    else alert(data.error ?? "No billing account yet");
  }
  return (
    <button onClick={go} disabled={loading} className="btn-ghost">
      {loading ? "…" : "Manage billing"}
    </button>
  );
}

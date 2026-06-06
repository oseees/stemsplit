"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { Check, Zap, Crown, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import {
  getPaymentConfig, createPayPalOrder, capturePayPalOrder,
  setStoredLicense, isProUser, type PaymentConfig,
} from "@/lib/api";

const proFeatures = [
  "Unlimited stem separations",
  "Priority processing queue",
  "High-quality Demucs model",
  "7-day file retention",
  "Bulk upload support",
  "API access",
];

export default function UpgradePage() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setPro(isProUser());
    getPaymentConfig()
      .then(setConfig)
      .catch(() => setError("Could not load payment configuration."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="pt-16 min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-purple-400" />
      </div>
    );
  }

  if (pro || success) {
    return (
      <div className="pt-16 min-h-screen flex items-center justify-center px-6">
        <div className="glass-card neon-border rounded-2xl p-10 text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center mx-auto mb-5">
            <Crown size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2">You&apos;re Pro! 🎉</h1>
          <p className="text-white/50 mb-6">Unlimited separations and priority processing are now unlocked.</p>
          <Link href="/upload" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-semibold">
            <Zap size={16} /> Start Separating
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-16 min-h-screen flex items-center justify-center px-6 py-12">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card neon-border text-sm text-purple-300 mb-4">
            <Crown size={14} /> One-time payment · Lifetime access
          </div>
          <h1 className="text-3xl font-bold mb-2">Unlock <span className="gradient-text">Pro</span></h1>
          <p className="text-white/50">Pay once, keep Pro forever. No subscription.</p>
        </div>

        <div className="glass-card neon-border rounded-2xl p-8">
          <div className="flex items-end gap-1 mb-6">
            <span className="text-5xl font-black gradient-text">
              {config?.currency === "USD" ? "$" : ""}{config?.price ?? "9.99"}
            </span>
            <span className="text-white/40 mb-2">one-time</span>
          </div>

          <ul className="space-y-3 mb-8">
            {proFeatures.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-white/70">
                <Check size={16} className="text-purple-400 shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          {error && (
            <div className="mb-4 flex items-center gap-2 text-red-400 text-sm glass-card rounded-xl px-4 py-3 border border-red-500/20">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {!config?.configured ? (
            <div className="text-center text-sm text-white/40 glass-card rounded-xl px-4 py-6 border border-white/5">
              PayPal isn&apos;t configured yet.<br />
              Add <code className="text-purple-300">PAYPAL_CLIENT_ID</code> and{" "}
              <code className="text-purple-300">PAYPAL_SECRET</code> to the backend env.
            </div>
          ) : (
            <PayPalScriptProvider
              options={{
                clientId: config.client_id,
                currency: config.currency,
                intent: "capture",
              }}
            >
              <PayPalButtons
                style={{ layout: "vertical", color: "blue", shape: "pill", label: "pay" }}
                createOrder={async () => {
                  setError("");
                  return await createPayPalOrder();
                }}
                onApprove={async (data) => {
                  try {
                    const result = await capturePayPalOrder(data.orderID);
                    if (result.status === "pro" && result.license) {
                      setStoredLicense(result.license);
                      setSuccess(true);
                    } else {
                      setError("Payment could not be confirmed.");
                    }
                  } catch {
                    setError("Failed to confirm payment. If you were charged, contact support.");
                  }
                }}
                onError={() => setError("PayPal checkout failed. Please try again.")}
              />
            </PayPalScriptProvider>
          )}
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

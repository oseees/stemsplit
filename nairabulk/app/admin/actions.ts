"use server"

import { revalidatePath } from "next/cache"
import { getSessionUser } from "@/lib/auth"
import { captureRateSnapshot } from "@/lib/fx"
import { refundFailedCampaign, type RefundReport } from "@/lib/refund"

async function requireAdmin(): Promise<boolean> {
  const session = await getSessionUser()
  return session?.profile?.role === "ADMIN"
}

export async function refreshRatesAction(): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorized" }
  try {
    await captureRateSnapshot()
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    console.error("[refreshRates]", err)
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fetch rates" }
  }
}

export async function refundCampaignAction(
  campaignId: string
): Promise<{ ok: boolean; error?: string; report?: RefundReport }> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorized" }
  try {
    const report = await refundFailedCampaign(campaignId)
    revalidatePath("/admin")
    return { ok: true, report }
  } catch (err) {
    console.error("[refundCampaign]", err)
    return { ok: false, error: err instanceof Error ? err.message : "Refund failed" }
  }
}

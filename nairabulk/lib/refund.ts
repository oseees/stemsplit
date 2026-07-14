import { prisma } from "./prisma"
import { toKobo } from "./payment"
// paystack.ts is `server-only` — loaded lazily below, skipped entirely when a fake is injected.

type RefundFn = (reference: string, amountKobo?: number) => Promise<void>

export type RefundReport = {
  refunded: string[] // commitment ids refunded
  failed: { commitmentId: string; error: string }[]
  skipped: string[] // PAID commitments with no verifiable SUCCESS payment
}

// Refund every PAID commitment on a failed campaign. Each refund is independent:
// one failure is logged and reported, never silently swallowed, and never blocks
// the others. A commitment only flips to REFUNDED once Paystack accepts its refund.
export async function refundFailedCampaign(
  campaignId: string,
  opts: { refundFn?: RefundFn } = {}
): Promise<RefundReport> {
  const refundFn: RefundFn = opts.refundFn ?? (await import("./paystack")).refundTransaction

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error("Campaign not found")
  if (campaign.status !== "FAILED_REFUNDED") {
    throw new Error("Only FAILED_REFUNDED campaigns can be refunded")
  }

  const commitments = await prisma.commitment.findMany({
    where: { campaignId, paymentStatus: "PAID" },
    include: { payments: { where: { status: "SUCCESS" } } },
  })

  const report: RefundReport = { refunded: [], failed: [], skipped: [] }

  for (const c of commitments) {
    const payment = c.payments[0]
    if (!payment?.paystackReference) {
      console.error(`[refund] commitment ${c.id} is PAID but has no SUCCESS payment to refund`)
      report.skipped.push(c.id)
      continue
    }
    try {
      await refundFn(payment.paystackReference, toKobo(payment.amountNaira.toNumber()))
      await prisma.$transaction([
        prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
        prisma.commitment.update({ where: { id: c.id }, data: { paymentStatus: "REFUNDED" } }),
      ])
      report.refunded.push(c.id)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`[refund] FAILED for commitment ${c.id} ref=${payment.paystackReference}: ${error}`)
      report.failed.push({ commitmentId: c.id, error })
    }
  }

  return report
}

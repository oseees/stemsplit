import { prisma } from "./prisma"
// Type-only import: paystack.ts is `server-only`, so we load its real functions
// lazily below (and never at all when a fake is injected for tests).
import type { VerifiedTransaction } from "./paystack"

export const toKobo = (amountNaira: number) => Math.round(amountNaira * 100)

export type VerifyResult = { ok: true; alreadyDone?: boolean } | { ok: false; error: string }

type VerifyFn = (reference: string) => Promise<VerifiedTransaction>

// Server-side source of truth for whether a payment succeeded. Never trusts the
// client callback: it re-verifies with Paystack and checks the amount/currency
// against what we recorded before marking anything PAID.
export async function recordVerifiedPayment(
  reference: string,
  opts: { verifyFn?: VerifyFn; expectedUserId?: string } = {}
): Promise<VerifyResult> {
  const { expectedUserId } = opts
  const verifyFn: VerifyFn = opts.verifyFn ?? (await import("./paystack")).verifyTransaction

  const payment = await prisma.payment.findUnique({
    where: { paystackReference: reference },
    include: { commitment: true },
  })
  if (!payment) return { ok: false, error: "Unknown payment reference" }
  if (expectedUserId && payment.commitment.userId !== expectedUserId) {
    return { ok: false, error: "This payment isn't yours" }
  }
  if (payment.status === "SUCCESS") return { ok: true, alreadyDone: true }

  const txn = await verifyFn(reference)
  const expectedKobo = toKobo(payment.amountNaira.toNumber())

  if (txn.status !== "success") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } })
    return { ok: false, error: "Payment was not completed" }
  }
  if (txn.currency !== "NGN" || txn.amount !== expectedKobo) {
    console.error(
      `[payment] amount/currency mismatch ref=${reference} expected=${expectedKobo}NGN got=${txn.amount}${txn.currency}`
    )
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } })
    return { ok: false, error: "Payment amount did not match — not marked paid" }
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCESS", paidAt: new Date() },
    }),
    prisma.commitment.update({
      where: { id: payment.commitmentId },
      data: { paymentStatus: "PAID" },
    }),
  ])
  return { ok: true }
}

"use server"

import { randomUUID } from "crypto"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { toKobo, recordVerifiedPayment, type VerifyResult } from "@/lib/payment"
import { initializeTransaction } from "@/lib/paystack"

export type InitiateResult =
  | { ok: true; accessCode: string; reference: string }
  | { ok: false; error: string }

// Starts a Paystack transaction for a commitment. Amount is computed here from
// the DB (priceLockedInNaira × quantity) — the client never dictates what's charged.
export async function initiatePaymentAction(commitmentId: string): Promise<InitiateResult> {
  const session = await getSessionUser()
  if (!session?.profile) return { ok: false, error: "Please log in again" }

  const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } })
  if (!commitment || commitment.userId !== session.user.id) {
    return { ok: false, error: "Commitment not found" }
  }
  if (commitment.paymentStatus === "PAID") {
    return { ok: false, error: "This commitment is already paid" }
  }

  const amountNaira = commitment.priceLockedInNaira.toNumber() * commitment.quantity
  const reference = `NB-${randomUUID()}`

  try {
    const { accessCode } = await initializeTransaction({
      email: session.profile.email,
      amountKobo: toKobo(amountNaira),
      reference,
    })
    // Mark any earlier unfinished attempts as abandoned, then record this one.
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { commitmentId, status: "PENDING" },
        data: { status: "FAILED" },
      }),
      prisma.payment.create({
        data: { commitmentId, amountNaira: amountNaira.toFixed(2), paystackReference: reference, status: "PENDING" },
      }),
    ])
    return { ok: true, accessCode, reference }
  } catch (err) {
    console.error("[initiatePayment]", err)
    return { ok: false, error: "Could not start payment — please try again" }
  }
}

export async function verifyPaymentAction(reference: string): Promise<VerifyResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: "Please log in again" }
  return recordVerifiedPayment(reference, { expectedUserId: session.user.id })
}

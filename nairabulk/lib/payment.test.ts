// Run: npx tsx lib/payment.test.ts — hits local dev DB with fake Paystack fns, self-cleaning.
import "dotenv/config"
import assert from "node:assert"
import { prisma } from "./prisma"
import { recordVerifiedPayment, toKobo } from "./payment"
import { refundFailedCampaign } from "./refund"
import type { VerifiedTransaction } from "./paystack"
import type { CampaignStatus } from "./generated/prisma/enums"

async function scaffold(status: CampaignStatus = "OPEN") {
  const supplier = await prisma.supplier.create({ data: { name: "_pay supplier" } })
  const product = await prisma.product.create({
    data: { name: "_pay product", category: "PHONE", images: [], baseCostRmb: "100.00", supplierId: supplier.id },
  })
  const campaign = await prisma.campaign.create({
    data: {
      title: "_pay campaign", productId: product.id, moq: 1,
      priceTiers: [{ minUnits: 1, pricePerUnitNaira: 1000 }],
      currentTierPrice: "1000.00", deadline: new Date(Date.now() + 86400000), status,
    },
  })
  const user = await prisma.user.create({
    data: { email: "_pay@test.local", phone: "+2348097000001", fullName: "_Pay User" },
  })
  const commitment = await prisma.commitment.create({
    data: { campaignId: campaign.id, userId: user.id, quantity: 2, priceLockedInNaira: "1000.00", paymentStatus: "PENDING" },
  })
  return { supplier, product, campaign, user, commitment }
}

async function cleanup() {
  await prisma.payment.deleteMany({ where: { paystackReference: { startsWith: "_payref" } } })
  await prisma.commitment.deleteMany({ where: { user: { email: "_pay@test.local" } } })
  await prisma.campaign.deleteMany({ where: { title: "_pay campaign" } })
  await prisma.product.deleteMany({ where: { name: "_pay product" } })
  await prisma.supplier.deleteMany({ where: { name: "_pay supplier" } })
  await prisma.user.deleteMany({ where: { email: "_pay@test.local" } })
}

const verified = (over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
  status: "success", amount: 200000, currency: "NGN", reference: "_payref1", ...over,
})

async function main() {
  await cleanup()

  // --- happy path: verify marks Payment SUCCESS + Commitment PAID ---
  {
    const { commitment } = await scaffold()
    await prisma.payment.create({
      data: { commitmentId: commitment.id, amountNaira: "2000.00", paystackReference: "_payref1", status: "PENDING" },
    })
    const r = await recordVerifiedPayment("_payref1", { verifyFn: async () => verified() })
    assert.ok(r.ok, "verify should succeed")
    const p = await prisma.payment.findUniqueOrThrow({ where: { paystackReference: "_payref1" } })
    assert.equal(p.status, "SUCCESS")
    assert.ok(p.paidAt)
    const c = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } })
    assert.equal(c.paymentStatus, "PAID")
    // idempotent second call
    const again = await recordVerifiedPayment("_payref1", { verifyFn: async () => { throw new Error("should not be called") } })
    assert.ok(again.ok && again.alreadyDone)
    await cleanup()
  }

  // --- amount tamper: Paystack reports wrong amount → rejected, stays unpaid ---
  {
    const { commitment } = await scaffold()
    await prisma.payment.create({
      data: { commitmentId: commitment.id, amountNaira: "2000.00", paystackReference: "_payref2", status: "PENDING" },
    })
    const r = await recordVerifiedPayment("_payref2", { verifyFn: async () => verified({ amount: 100, reference: "_payref2" }) })
    assert.ok(!r.ok, "mismatched amount must be rejected")
    const p = await prisma.payment.findUniqueOrThrow({ where: { paystackReference: "_payref2" } })
    assert.equal(p.status, "FAILED")
    const c = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } })
    assert.equal(c.paymentStatus, "PENDING", "commitment must not be PAID on mismatch")
    await cleanup()
  }

  // --- ownership guard ---
  {
    const { commitment } = await scaffold()
    await prisma.payment.create({
      data: { commitmentId: commitment.id, amountNaira: "2000.00", paystackReference: "_payref3", status: "PENDING" },
    })
    const r = await recordVerifiedPayment("_payref3", { expectedUserId: "someone-else", verifyFn: async () => verified({ reference: "_payref3" }) })
    assert.ok(!r.ok && /isn't yours/.test(r.error))
    await cleanup()
  }

  // --- refund: PAID commitment on FAILED_REFUNDED campaign → REFUNDED ---
  {
    const { campaign, commitment } = await scaffold("FAILED_REFUNDED")
    await prisma.commitment.update({ where: { id: commitment.id }, data: { paymentStatus: "PAID" } })
    await prisma.payment.create({
      data: { commitmentId: commitment.id, amountNaira: "2000.00", paystackReference: "_payref4", status: "SUCCESS", paidAt: new Date() },
    })

    let refundedRef: string | null = null
    let refundedKobo: number | null = null
    const report = await refundFailedCampaign(campaign.id, {
      refundFn: async (ref, kobo) => { refundedRef = ref; refundedKobo = kobo ?? null },
    })
    assert.equal(report.refunded.length, 1)
    assert.equal(report.failed.length, 0)
    assert.equal(refundedRef, "_payref4")
    assert.equal(refundedKobo, toKobo(2000))
    const c = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } })
    assert.equal(c.paymentStatus, "REFUNDED")
    const p = await prisma.payment.findUniqueOrThrow({ where: { paystackReference: "_payref4" } })
    assert.equal(p.status, "REFUNDED")
    await cleanup()
  }

  // --- refund failure is reported, not swallowed; commitment stays PAID ---
  {
    const { campaign, commitment } = await scaffold("FAILED_REFUNDED")
    await prisma.commitment.update({ where: { id: commitment.id }, data: { paymentStatus: "PAID" } })
    await prisma.payment.create({
      data: { commitmentId: commitment.id, amountNaira: "2000.00", paystackReference: "_payref5", status: "SUCCESS", paidAt: new Date() },
    })
    const report = await refundFailedCampaign(campaign.id, {
      refundFn: async () => { throw new Error("Paystack down") },
    })
    assert.equal(report.failed.length, 1)
    assert.match(report.failed[0].error, /Paystack down/)
    const c = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } })
    assert.equal(c.paymentStatus, "PAID", "failed refund must not flip to REFUNDED")
    await cleanup()
  }

  console.log("payment ok")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await cleanup().catch(() => {})
    await prisma.$disconnect()
    process.exit(1)
  })

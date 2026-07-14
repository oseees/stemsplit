// Run: npx tsx lib/campaign.test.ts — hits the local dev DB, cleans up after itself.
import "dotenv/config"
import assert from "node:assert"
import { prisma } from "./prisma"
import { joinCampaign, closeExpiredCampaigns } from "./campaign"

const days = (n: number) => new Date(Date.now() + n * 86_400_000)

async function makeCampaign(overrides: Record<string, unknown> = {}) {
  const supplier = await prisma.supplier.create({ data: { name: "_test supplier" } })
  const product = await prisma.product.create({
    data: {
      name: "_test product",
      category: "PHONE",
      images: [],
      baseCostRmb: "100.00",
      supplierId: supplier.id,
    },
  })
  const campaign = await prisma.campaign.create({
    data: {
      title: "_test campaign",
      productId: product.id,
      moq: 10,
      maxUnits: 20,
      priceTiers: [
        { minUnits: 10, pricePerUnitNaira: 1000 },
        { minUnits: 15, pricePerUnitNaira: 900 },
      ],
      currentTierPrice: "1000.00",
      deadline: days(7),
      status: "OPEN",
      ...overrides,
    },
  })
  return { supplier, product, campaign }
}

async function makeUsers(n: number) {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      prisma.user.create({
        data: {
          email: `_test${i}@test.local`,
          phone: `+23480999000${i.toString().padStart(2, "0")}`,
          fullName: `_Test User ${i}`,
        },
      })
    )
  )
}

async function cleanup() {
  await prisma.commitment.deleteMany({ where: { user: { email: { startsWith: "_test" } } } })
  await prisma.campaign.deleteMany({ where: { title: "_test campaign" } })
  await prisma.product.deleteMany({ where: { name: "_test product" } })
  await prisma.supplier.deleteMany({ where: { name: "_test supplier" } })
  await prisma.user.deleteMany({ where: { email: { startsWith: "_test" } } })
}

async function main() {
  await cleanup()

  // --- concurrent joins don't lose updates and cross the tier correctly ---
  const { campaign } = await makeCampaign()
  const users = await makeUsers(5)
  const results = await Promise.all(users.map((u) => joinCampaign(campaign.id, u.id, 3)))
  assert.ok(results.every((r) => r.ok), "all 5 concurrent joins should succeed")

  const after = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })
  assert.equal(after.unitsCommitted, 15, "no lost updates under concurrency")
  assert.equal(after.currentTierPrice.toNumber(), 900, "15 units crosses the 900 tier")

  const commitments = await prisma.commitment.findMany({ where: { campaignId: campaign.id } })
  assert.equal(commitments.length, 5)
  assert.ok(commitments.every((c) => c.paymentStatus === "PENDING"))

  // --- maxUnits cap enforced (15 committed, cap 20 → qty 6 must fail) ---
  const capped = await joinCampaign(campaign.id, users[0].id, 6)
  assert.ok(!capped.ok && /spot/i.test(capped.error), "over-cap join rejected")

  // --- bad quantity rejected ---
  const bad = await joinCampaign(campaign.id, users[0].id, 0)
  assert.ok(!bad.ok)

  // --- deadline passed → reject join ---
  const { campaign: expired } = await makeCampaign({ deadline: days(-1) })
  const late = await joinCampaign(expired.id, users[0].id, 1)
  assert.ok(!late.ok && /deadline/i.test(late.error), "late join rejected")

  // --- closeExpiredCampaigns: under-MOQ fails + refund-flags PAID commitments ---
  await prisma.commitment.create({
    data: {
      campaignId: expired.id,
      userId: users[1].id,
      quantity: 2,
      priceLockedInNaira: "1000.00",
      paymentStatus: "PAID",
    },
  })
  // over-MOQ expired campaign → MOQ_REACHED
  const { campaign: winner } = await makeCampaign({ deadline: days(-1), unitsCommitted: 12 })

  const closed = await closeExpiredCampaigns()
  assert.ok(closed.failed >= 1 && closed.moqReached >= 1)

  const failedAfter = await prisma.campaign.findUniqueOrThrow({ where: { id: expired.id } })
  assert.equal(failedAfter.status, "FAILED_REFUNDED")
  // Closing a failed campaign flags the CAMPAIGN only — commitments stay PAID
  // until the refund action actually processes the Paystack refund.
  const stillPaid = await prisma.commitment.findFirstOrThrow({ where: { campaignId: expired.id } })
  assert.equal(stillPaid.paymentStatus, "PAID", "paid commitment left for refund action")

  const winnerAfter = await prisma.campaign.findUniqueOrThrow({ where: { id: winner.id } })
  assert.equal(winnerAfter.status, "MOQ_REACHED")

  await cleanup()
  console.log("campaign ok")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await cleanup().catch(() => {})
    await prisma.$disconnect()
    process.exit(1)
  })

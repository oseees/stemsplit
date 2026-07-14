import { prisma } from "./prisma"
import { currentTierPrice, type PriceTier } from "./pricing"

export type JoinResult =
  | { ok: true; commitmentId: string; pricePerUnit: number }
  | { ok: false; error: string }

// Atomically add a commitment: locks the campaign row so concurrent joins
// can't double-spend the unit count or cache a stale tier price.
export async function joinCampaign(
  campaignId: string,
  userId: string,
  quantity: number
): Promise<JoinResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    return { ok: false, error: "Enter a valid quantity" }
  }

  return prisma.$transaction(async (tx) => {
    // Row lock — serializes concurrent joins on the same campaign.
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId} FOR UPDATE`

    const campaign = await tx.campaign.findUnique({ where: { id: campaignId } })
    if (!campaign) return { ok: false, error: "Campaign not found" }
    if (campaign.status !== "OPEN") return { ok: false, error: "This campaign is closed" }
    if (campaign.deadline <= new Date()) {
      return { ok: false, error: "This campaign's deadline has passed" }
    }

    const newUnits = campaign.unitsCommitted + quantity
    if (campaign.maxUnits != null && newUnits > campaign.maxUnits) {
      const left = campaign.maxUnits - campaign.unitsCommitted
      return {
        ok: false,
        error: left <= 0 ? "This campaign is fully booked" : `Only ${left} spot${left === 1 ? "" : "s"} left`,
      }
    }

    // Their own units count toward the tier — joining can itself unlock a better price.
    const price = currentTierPrice(campaign.priceTiers as PriceTier[], newUnits)

    const commitment = await tx.commitment.create({
      data: {
        campaignId,
        userId,
        quantity,
        priceLockedInNaira: price.toFixed(2),
        paymentStatus: "PENDING",
      },
    })
    await tx.campaign.update({
      where: { id: campaignId },
      data: { unitsCommitted: newUnits, currentTierPrice: price.toFixed(2) },
    })

    return { ok: true, commitmentId: commitment.id, pricePerUnit: price }
  })
}

// Close campaigns past their deadline. Called from the cron API route.
export async function closeExpiredCampaigns() {
  const expired = await prisma.campaign.findMany({
    where: { status: "OPEN", deadline: { lt: new Date() } },
    select: { id: true, unitsCommitted: true, moq: true },
  })

  const result = { moqReached: 0, failed: 0 }
  for (const c of expired) {
    if (c.unitsCommitted >= c.moq) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: "MOQ_REACHED" } })
      result.moqReached++
    } else {
      // Flag the campaign as failed. Commitments stay PAID until the admin refund
      // action actually processes the Paystack refund (see lib/refund.ts) — only
      // then do they flip to REFUNDED.
      await prisma.campaign.update({ where: { id: c.id }, data: { status: "FAILED_REFUNDED" } })
      result.failed++
    }
  }
  return result
}

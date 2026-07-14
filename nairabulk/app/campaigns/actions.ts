"use server"

import { getSessionUser } from "@/lib/auth"
import { joinCampaign } from "@/lib/campaign"

export type JoinActionResult = { error?: string; redirectTo?: string }

export async function joinCampaignAction(
  campaignId: string,
  quantity: number
): Promise<JoinActionResult> {
  const session = await getSessionUser()
  if (!session?.profile) {
    return { redirectTo: `/login?next=/campaigns/${campaignId}` }
  }

  const result = await joinCampaign(campaignId, session.profile.id, quantity)
  if (!result.ok) return { error: result.error }

  return { redirectTo: `/dashboard/commitments/${result.commitmentId}` }
}

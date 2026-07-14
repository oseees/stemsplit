import { NextResponse } from "next/server"
import { closeExpiredCampaigns } from "@/lib/campaign"

// Trigger via cron: GET /api/cron/close-campaigns
// Set CRON_SECRET in env and send "Authorization: Bearer <secret>". If the env
// var is unset (local dev), the route is open.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const result = await closeExpiredCampaigns()
  return NextResponse.json(result)
}

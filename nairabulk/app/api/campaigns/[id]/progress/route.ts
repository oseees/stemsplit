import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Polled by the campaign detail page for live progress.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const c = await prisma.campaign.findUnique({
    where: { id },
    select: {
      unitsCommitted: true,
      currentTierPrice: true,
      status: true,
      moq: true,
      maxUnits: true,
      deadline: true,
      _count: { select: { commitments: true } },
    },
  })
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 })

  return NextResponse.json({
    unitsCommitted: c.unitsCommitted,
    currentTierPrice: c.currentTierPrice.toNumber(),
    status: c.status,
    moq: c.moq,
    maxUnits: c.maxUnits,
    deadline: c.deadline.toISOString(),
    backers: c._count.commitments,
  })
}

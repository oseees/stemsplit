import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { naira } from "@/lib/format"
import PayButton from "./PayButton"
import FxDisclosure from "@/components/FxDisclosure"

export const dynamic = "force-dynamic"
export const metadata = { title: "You're in — NairaBulk" }

export default async function CommitmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session) redirect("/login")

  const commitment = await prisma.commitment.findUnique({
    where: { id },
    include: { campaign: { include: { product: { select: { name: true } } } } },
  })
  // Only the owner sees their commitment.
  if (!commitment || commitment.userId !== session.user.id) notFound()

  const price = commitment.priceLockedInNaira.toNumber()
  const total = price * commitment.quantity

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <p className="text-4xl">🎉</p>
      <h1 className="mt-2 text-2xl font-bold">You&apos;re in!</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your spot in this group buy is reserved.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 p-4 text-sm">
        <p className="font-semibold">{commitment.campaign.title}</p>
        <p className="text-gray-500">{commitment.campaign.product.name}</p>
        <dl className="mt-3 space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-gray-500">Quantity</dt>
            <dd className="font-medium">{commitment.quantity}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Price locked in</dt>
            <dd className="font-medium">{naira(price)} / unit</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-1.5">
            <dt className="font-semibold">Total</dt>
            <dd className="font-bold text-primary-700">{naira(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Payment</dt>
            <dd className="font-medium text-accent-600">
              {commitment.paymentStatus === "PENDING" ? "Pending" : commitment.paymentStatus}
            </dd>
          </div>
        </dl>
      </div>

      {commitment.paymentStatus === "PENDING" && (
        <>
          <PayButton commitmentId={commitment.id} amountNaira={total} />
          <p className="mt-2 text-center text-xs text-gray-400">
            If the price drops before the deadline, you&apos;ll be charged the lower price.
          </p>
        </>
      )}
      {commitment.paymentStatus === "PAID" && (
        <p className="mt-5 rounded-md bg-primary-50 px-4 py-3 text-center font-semibold text-primary-800">
          ✓ Payment received — you&apos;re fully committed.
        </p>
      )}
      {commitment.paymentStatus === "REFUNDED" && (
        <p className="mt-5 rounded-md bg-gray-100 px-4 py-3 text-center font-medium text-gray-600">
          This campaign didn&apos;t reach its target. Your payment has been refunded.
        </p>
      )}

      <FxDisclosure />

      <Link
        href={`/campaigns/${commitment.campaignId}`}
        className="mt-4 block text-center text-sm text-primary-700 hover:underline"
      >
        Back to campaign
      </Link>
    </div>
  )
}

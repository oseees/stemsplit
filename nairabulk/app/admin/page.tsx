import { prisma } from "@/lib/prisma"
import { latestRateSnapshot } from "@/lib/fx"
import { computeUnitMargin } from "@/lib/margin"
import { naira } from "@/lib/format"
import { RefreshRatesButton, RefundButton } from "./AdminClient"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin — NairaBulk" }

const thresholdPct = Number(process.env.MARGIN_THRESHOLD_PCT ?? 15)

export default async function AdminPage() {
  const [users, campaigns, suppliers, rate, readyToPay, failed] = await Promise.all([
    prisma.user.count(),
    prisma.campaign.count(),
    prisma.supplier.count(),
    latestRateSnapshot(),
    prisma.campaign.findMany({
      where: { status: "MOQ_REACHED" },
      include: { product: { select: { name: true, baseCostRmb: true } } },
    }),
    prisma.campaign.findMany({
      where: { status: "FAILED_REFUNDED" },
      include: { _count: { select: { commitments: true } }, commitments: { where: { paymentStatus: "PAID" }, select: { id: true } } },
    }),
  ])

  const rmbToNgn = rate?.rmbToNgnRate.toNumber() ?? null
  const capturedAt = rate?.capturedAt.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const stats = [
    { label: "Users", value: users },
    { label: "Campaigns", value: campaigns },
    { label: "Suppliers", value: suppliers },
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold">Admin</h1>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 p-4 text-center">
            <p className="text-3xl font-bold text-primary-700">{s.value}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Exchange rate — the audit-trail snapshot we price/pay against */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">Exchange rate</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
          {rmbToNgn != null ? (
            <div className="text-sm">
              <p className="text-2xl font-bold text-gray-900">₦{rmbToNgn.toFixed(2)} / ¥1</p>
              <p className="text-gray-500">
                USD ₦{rate!.usdToNgnRate.toNumber().toFixed(2)} · captured {capturedAt} · {rate!.source}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No rate captured yet.</p>
          )}
          <RefreshRatesButton />
        </div>
      </section>

      {/* Margin check for campaigns ready to pay their supplier */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">Margin check — campaigns ready to order</h2>
        <p className="mt-1 text-sm text-gray-500">
          Margin at the latest rate above. Flagged if below {thresholdPct}% of sale price.
        </p>
        {readyToPay.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No campaigns are at MOQ yet.</p>
        ) : rmbToNgn == null ? (
          <p className="mt-3 text-sm text-gray-500">Capture an exchange rate to compute margins.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-4 py-2 font-medium">Sale / unit</th>
                  <th className="px-4 py-2 font-medium">Cost / unit</th>
                  <th className="px-4 py-2 font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {readyToPay.map((c) => {
                  const m = computeUnitMargin({
                    targetNairaPerUnit: c.currentTierPrice.toNumber(),
                    baseCostRmb: c.product.baseCostRmb.toNumber(),
                    rmbToNgn,
                    thresholdPct,
                  })
                  return (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">{c.title}</td>
                      <td className="px-4 py-2">{naira(c.currentTierPrice.toNumber())}</td>
                      <td className="px-4 py-2">{naira(Math.round(m.costNaira))}</td>
                      <td className="px-4 py-2">
                        <span className={m.belowThreshold ? "font-bold text-red-600" : "font-semibold text-primary-700"}>
                          {m.marginPct.toFixed(1)}%
                          {m.belowThreshold && " ⚠︎ low"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Failed campaigns — trigger refunds */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">Failed campaigns — refunds</h2>
        {failed.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No failed campaigns.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {failed.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-200 p-4">
                <p className="font-semibold">{c.title}</p>
                <p className="text-sm text-gray-500">
                  {c.commitments.length} paid buyer{c.commitments.length === 1 ? "" : "s"} awaiting refund
                  {" · "}
                  {c._count.commitments} total commitment{c._count.commitments === 1 ? "" : "s"}
                </p>
                <RefundButton campaignId={c.id} paidCount={c.commitments.length} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

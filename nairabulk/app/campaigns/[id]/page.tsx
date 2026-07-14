import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { naira } from "@/lib/format";
import { type PriceTier } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import JoinPanel from "@/components/JoinPanel";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      product: true,
      _count: { select: { commitments: true } },
    },
  });

  if (!campaign) notFound();

  const { product } = campaign;
  const tiers = (campaign.priceTiers as PriceTier[])
    .slice()
    .sort((a, b) => a.minUnits - b.minUnits);
  const price = campaign.currentTierPrice.toNumber();
  const specs =
    product.specs && typeof product.specs === "object"
      ? (product.specs as Record<string, unknown>)
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/campaigns" className="text-sm text-primary-700 hover:underline">
        ← Back to campaigns
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
          {/* ponytail: plain img, remote placeholder URLs */}
          <img
            src={product.images[0]}
            alt={product.name}
            className="aspect-square w-full object-cover"
          />
        </div>

        <div>
          <div className="flex items-center gap-3">
            <StatusBadge status={campaign.status} />
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {product.category}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-bold">{campaign.title}</h1>
          <p className="mt-1 text-gray-500">{product.name}</p>

          <div className="mt-5">
            <JoinPanel
              campaignId={campaign.id}
              unitsCommitted={campaign.unitsCommitted}
              moq={campaign.moq}
              maxUnits={campaign.maxUnits}
              price={price}
              backers={campaign._count.commitments}
              deadline={campaign.deadline.toISOString()}
              status={campaign.status}
            />
          </div>
        </div>
      </div>

      {/* Price tiers — the hook of the platform */}
      <section className="mt-10">
        <h2 className="text-lg font-bold">Price drops as more people join</h2>
        <div className="mt-3 overflow-hidden rounded-lg border-2 border-primary-200">
          <table className="w-full text-sm">
            <thead className="bg-primary-50 text-left text-primary-900">
              <tr>
                <th className="px-4 py-3 font-semibold">If we hit…</th>
                <th className="px-4 py-3 font-semibold">Price drops to</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                const reached = campaign.unitsCommitted >= tier.minUnits;
                const active = reached && price === tier.pricePerUnitNaira;
                return (
                  <tr
                    key={tier.minUnits}
                    className={`border-t border-primary-100 ${
                      active
                        ? "bg-primary-600 font-bold text-white"
                        : reached
                          ? "text-gray-400 line-through"
                          : "font-medium"
                    }`}
                  >
                    <td className="px-4 py-3">{tier.minUnits}+ units</td>
                    <td className="px-4 py-3">
                      {naira(tier.pricePerUnitNaira)}
                      {active && <span className="ml-2 text-xs font-semibold">✓ current price</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Description + specs */}
      {(product.description || specs) && (
        <section className="mt-10 grid gap-8 md:grid-cols-2">
          {product.description && (
            <div>
              <h2 className="text-lg font-bold">About</h2>
              <p className="mt-2 text-gray-600">{product.description}</p>
            </div>
          )}
          {specs && (
            <div>
              <h2 className="text-lg font-bold">Specs</h2>
              <dl className="mt-2 divide-y divide-gray-100 text-sm">
                {Object.entries(specs).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-1.5">
                    <dt className="text-gray-500">{key}</dt>
                    <dd className="font-medium text-gray-800">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

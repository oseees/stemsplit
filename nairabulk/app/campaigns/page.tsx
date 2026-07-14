import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ProductCategory } from "@/lib/generated/prisma/enums";
import CampaignCard, { type CampaignCardData } from "@/components/CampaignCard";

export const dynamic = "force-dynamic"; // always reflect latest commitments

export const metadata = {
  title: "Browse Campaigns — NairaBulk",
};

const TABS: { label: string; category?: ProductCategory }[] = [
  { label: "All" },
  { label: "Phones", category: "PHONE" },
  { label: "Tablets", category: "TABLET" },
  { label: "Laptops", category: "LAPTOP" },
  { label: "Accessories", category: "ACCESSORY" },
];

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active = TABS.find((t) => t.category === category) ?? TABS[0];

  const campaigns = await prisma.campaign.findMany({
    where: active.category ? { product: { category: active.category } } : undefined,
    include: { product: { select: { name: true, category: true, images: true } } },
    orderBy: [{ status: "asc" }, { deadline: "asc" }],
  });

  const cards: CampaignCardData[] = campaigns.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    unitsCommitted: c.unitsCommitted,
    moq: c.moq,
    maxUnits: c.maxUnits,
    currentTierPrice: c.currentTierPrice.toNumber(),
    deadline: c.deadline,
    product: c.product,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Browse Campaigns</h1>
      <p className="mt-2 text-gray-600">
        Join a group buy before the deadline. The more people commit, the lower the price.
      </p>

      {/* Category tabs */}
      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const isActive = tab.label === active.label;
          return (
            <Link
              key={tab.label}
              href={tab.category ? `/campaigns?category=${tab.category}` : "/campaigns"}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${
                isActive
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {cards.length === 0 ? (
        <p className="mt-12 text-gray-500">
          No {active.category ? `${active.label.toLowerCase()} ` : ""}campaigns right now —
          check back soon.
        </p>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <CampaignCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

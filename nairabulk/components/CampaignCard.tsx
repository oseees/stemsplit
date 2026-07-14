import Link from "next/link";
import type { CampaignStatus, ProductCategory } from "@/lib/generated/prisma/enums";
import { naira, timeLeft, spotsLabel } from "@/lib/format";
import StatusBadge from "./StatusBadge";

export type CampaignCardData = {
  id: string;
  title: string;
  status: CampaignStatus;
  unitsCommitted: number;
  moq: number;
  maxUnits: number | null;
  currentTierPrice: number;
  deadline: Date;
  product: { name: string; category: ProductCategory; images: string[] };
};

export default function CampaignCard({ c }: { c: CampaignCardData }) {
  const pct = Math.min(100, Math.round((c.unitsCommitted / c.moq) * 100));
  const ended = c.status === "FAILED_REFUNDED" || c.status === "CANCELLED";

  return (
    <Link
      href={`/campaigns/${c.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-primary-300 hover:shadow-md"
    >
      <div className="relative aspect-square bg-gray-100">
        {/* ponytail: plain img — remote placeholder URLs, no next/image remotePatterns config needed */}
        <img
          src={c.product.images[0]}
          alt={c.product.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute left-3 top-3">
          <StatusBadge status={c.status} />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {c.product.category}
        </p>
        <h3 className="mt-1 font-semibold text-gray-900 group-hover:text-primary-700">
          {c.title}
        </h3>

        <p className="mt-2 text-lg font-bold text-primary-700">
          {naira(c.currentTierPrice)}
          <span className="text-sm font-normal text-gray-500"> / unit</span>
        </p>

        <div className="mt-auto pt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-medium text-gray-600">
              {c.unitsCommitted} / {c.moq} to unlock
            </span>
            <span className={ended ? "text-gray-400" : "font-semibold text-accent-600"}>
              {ended ? timeLeft(c.deadline) : spotsLabel(c)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

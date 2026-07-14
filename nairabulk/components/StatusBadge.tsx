import type { CampaignStatus } from "@/lib/generated/prisma/enums";

const styles: Record<CampaignStatus, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-primary-100 text-primary-800" },
  MOQ_REACHED: { label: "Unlocked", className: "bg-primary-600 text-white" },
  ORDERED_FROM_SUPPLIER: { label: "Ordered", className: "bg-blue-100 text-blue-800" },
  SHIPPED: { label: "Shipped", className: "bg-blue-100 text-blue-800" },
  DELIVERED: { label: "Delivered", className: "bg-gray-200 text-gray-700" },
  FAILED_REFUNDED: { label: "Refunded", className: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Cancelled", className: "bg-gray-200 text-gray-500" },
};

export default function StatusBadge({ status }: { status: CampaignStatus }) {
  const { label, className } = styles[status];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

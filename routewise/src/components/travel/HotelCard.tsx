"use client"

/* eslint-disable @next/next/no-img-element */
import type { HotelOffer } from "@/lib/providers/types"
import { money } from "@/lib/utils"

export default function HotelCard({
  offer,
  badge,
  selected,
  compareChecked,
  compareDisabled,
  onSelect,
  onCompareToggle,
  onHover,
}: {
  offer: HotelOffer
  badge?: string
  selected?: boolean
  compareChecked?: boolean
  compareDisabled?: boolean
  onSelect?: () => void
  onCompareToggle?: () => void
  onHover?: (price: number | null) => void
}) {
  return (
    <div
      className={`card flex flex-col gap-4 sm:flex-row ${selected ? "ring-2 ring-brand-500" : ""}`}
      onMouseEnter={() => onHover?.(offer.totalPrice)}
      onMouseLeave={() => onHover?.(null)}
    >
      <img
        src={offer.image}
        alt={offer.name}
        className="h-40 w-full rounded-xl object-cover sm:h-32 sm:w-44"
        loading="lazy"
      />
      <div className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">{offer.name}</h3>
              {badge && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {badge}
                </span>
              )}
            </div>
            <p className="text-sm text-amber-500">{"★".repeat(offer.stars)}</p>
          </div>
          <span className="rounded-lg bg-emerald-600 px-2 py-1 text-sm font-bold text-white">
            {offer.rating.toFixed(1)}
          </span>
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {offer.distanceKm} km from centre · {offer.cancellation}
        </p>

        {offer.amenities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {offer.amenities.map((a) => (
              <span key={a} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {a}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between pt-3">
          <div>
            <p className="text-xl font-bold">{money(offer.nightlyPrice, offer.currency)}<span className="text-sm font-normal text-slate-400"> /night</span></p>
            <p className="text-xs text-slate-500">
              {money(offer.totalPrice, offer.currency)} total · {offer.nights} night
              {offer.nights > 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={!!compareChecked}
                disabled={compareDisabled && !compareChecked}
                onChange={onCompareToggle}
              />
              Compare
            </label>
            <button className={selected ? "btn-ghost" : "btn-primary"} onClick={onSelect}>
              {selected ? "Selected" : "Select"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

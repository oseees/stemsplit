"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { naira, timeLeft, spotsLabel } from "@/lib/format"
import { joinCampaignAction } from "@/app/campaigns/actions"

export type JoinPanelProps = {
  campaignId: string
  unitsCommitted: number
  moq: number
  maxUnits: number | null
  price: number
  backers: number
  deadline: string // ISO
  status: string
}

// ponytail: 5s polling, not Supabase realtime — realtime needs live Supabase
// creds and a channel per campaign; a fetch every 5s does the job.
const POLL_MS = 5000

export default function JoinPanel(initial: JoinPanelProps) {
  const router = useRouter()
  const [live, setLive] = useState(initial)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${initial.campaignId}/progress`)
        if (!res.ok) return
        const p = await res.json()
        setLive((prev) => ({ ...prev, ...p, price: p.currentTierPrice }))
      } catch {
        // transient network error — keep last known state
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [initial.campaignId])

  const deadlineDate = new Date(live.deadline)
  const ended =
    live.status !== "OPEN" || deadlineDate.getTime() <= Date.now()
  const joinable = !ended
  const pct = Math.min(100, Math.round((live.unitsCommitted / live.moq) * 100))
  const spotsLeft = live.maxUnits != null ? live.maxUnits - live.unitsCommitted : null
  const maxQty = spotsLeft != null ? Math.max(1, spotsLeft) : 99

  async function join() {
    setError(null)
    setJoining(true)
    const res = await joinCampaignAction(initial.campaignId, quantity)
    if (res.redirectTo) return router.push(res.redirectTo)
    setError(res.error ?? "Something went wrong")
    setJoining(false)
  }

  return (
    <div>
      <p className="text-3xl font-bold text-primary-700">
        {naira(live.price)}
        <span className="text-base font-normal text-gray-500"> / unit</span>
      </p>

      {/* Live progress */}
      <div className="mt-5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-sm font-medium text-gray-700">
          {live.unitsCommitted} of {live.moq} units committed
          {joinable && (
            <span className="font-semibold text-accent-600"> — {timeLeft(deadlineDate)}</span>
          )}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {live.backers > 0
            ? `${live.backers} other buyer${live.backers === 1 ? " has" : "s have"} joined`
            : "Be the first to join"}
          {joinable && (
            <span className="text-gray-400"> · {spotsLabel(live)}</span>
          )}
        </p>
      </div>

      {joinable ? (
        <>
          {/* Quantity + join */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex items-center rounded-md border border-gray-300">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="px-4 py-3 text-lg font-semibold text-gray-600 hover:bg-gray-50"
              >
                −
              </button>
              <span className="w-10 text-center text-base font-semibold">{quantity}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                className="px-4 py-3 text-lg font-semibold text-gray-600 hover:bg-gray-50"
              >
                +
              </button>
            </div>
            <button
              onClick={join}
              disabled={joining}
              className="flex-1 rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {joining ? "Joining…" : "Join this group buy"}
            </button>
          </div>

          <p className="mt-2 text-sm font-medium text-gray-700">
            You pay {naira(live.price * quantity)}{" "}at today&apos;s tier.
          </p>
          {error && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Price may drop further if more people join before the deadline — you&apos;ll
            only ever be charged the best tier price reached by the deadline, never
            more than what you locked in.
          </p>
        </>
      ) : (
        <p className="mt-5 rounded-md bg-gray-100 px-4 py-3 text-center font-medium text-gray-500">
          This campaign is closed
        </p>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { refreshRatesAction, refundCampaignAction } from "./actions"

export function RefreshRatesButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const res = await refreshRatesAction()
    setBusy(false)
    if (res.ok) router.refresh()
    else setError(res.error ?? "Failed")
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {busy ? "Fetching…" : "Refresh rates now"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}

export function RefundButton({ campaignId, paidCount }: { campaignId: string; paidCount: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!confirm(`Refund ${paidCount} paid buyer(s) for this campaign?`)) return
    setBusy(true)
    setError(null)
    setMsg(null)
    const res = await refundCampaignAction(campaignId)
    setBusy(false)
    if (!res.ok) return setError(res.error ?? "Refund failed")
    const r = res.report!
    setMsg(
      `Refunded ${r.refunded.length}. ${r.failed.length} failed${
        r.skipped.length ? `, ${r.skipped.length} skipped` : ""
      }.`
    )
    router.refresh()
  }

  return (
    <div className="mt-2">
      <button
        onClick={run}
        disabled={busy || paidCount === 0}
        className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? "Refunding…" : `Refund ${paidCount} paid buyer${paidCount === 1 ? "" : "s"}`}
      </button>
      {msg && <p className="mt-2 text-sm text-gray-700">{msg}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}

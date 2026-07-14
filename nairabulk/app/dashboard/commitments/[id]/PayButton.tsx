"use client"

import { useState } from "react"
import Script from "next/script"
import { useRouter } from "next/navigation"
import { naira } from "@/lib/format"
import { initiatePaymentAction, verifyPaymentAction } from "./actions"

// Minimal shape of Paystack v2 inline we use.
type PaystackPopup = {
  resumeTransaction: (
    accessCode: string,
    handlers?: { onSuccess?: () => void; onCancel?: () => void; onError?: () => void }
  ) => void
}
declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopup
  }
}

type State = "idle" | "starting" | "paying" | "verifying" | "error"

export default function PayButton({
  commitmentId,
  amountNaira,
}: {
  commitmentId: string
  amountNaira: number
}) {
  const router = useRouter()
  const [state, setState] = useState<State>("idle")
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setError(null)
    if (!window.PaystackPop) {
      setState("error")
      setError("Payment is still loading — please try again in a moment.")
      return
    }

    setState("starting")
    const init = await initiatePaymentAction(commitmentId)
    if (!init.ok) {
      setState("error")
      setError(init.error)
      return
    }

    setState("paying")
    const popup = new window.PaystackPop()
    popup.resumeTransaction(init.accessCode, {
      onSuccess: async () => {
        setState("verifying")
        const res = await verifyPaymentAction(init.reference)
        if (res.ok) {
          router.refresh() // server page re-renders in the PAID state
        } else {
          setState("error")
          setError(res.error)
        }
      },
      onCancel: () => {
        setState("error")
        setError("Payment cancelled. You can try again.")
      },
      onError: () => {
        setState("error")
        setError("Something went wrong with the payment. Please try again.")
      },
    })
  }

  const busy = state === "starting" || state === "paying" || state === "verifying"
  const label =
    state === "verifying"
      ? "Confirming payment…"
      : busy
        ? "Opening payment…"
        : `Pay ${naira(amountNaira)}`

  return (
    <>
      <Script src="https://js.paystack.co/v2/inline.js" strategy="afterInteractive" />
      <button
        onClick={pay}
        disabled={busy}
        className="mt-5 w-full rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {label}
      </button>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
    </>
  )
}

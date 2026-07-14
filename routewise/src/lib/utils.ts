export const CATEGORY_COLORS: Record<string, string> = {
  Flights: "#0ea5e9",
  Accommodation: "#8b5cf6",
  Food: "#f59e0b",
  Transport: "#10b981",
  Activities: "#ef4444",
  Shopping: "#ec4899",
  Accessories: "#14b8a6",
  Miscellaneous: "#64748b",
}

export function money(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // Unknown currency code — fall back to plain number
    return `${currency} ${amount.toLocaleString()}`
  }
}

export function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function toDateInput(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10)
}

// Times from mock offers are in UTC; render them in UTC so they match the
// provider's schedule rather than the viewer's timezone.
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

export function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m.toString().padStart(2, "0")}m`
}

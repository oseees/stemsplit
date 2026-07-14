"use client"

import { useRouter } from "next/navigation"

export default function DeleteTripButton({ tripId }: { tripId: string }) {
  const router = useRouter()

  async function remove() {
    if (!confirm("Delete this trip and all its expenses? This cannot be undone.")) return
    const res = await fetch(`/api/trips/${tripId}`, { method: "DELETE" })
    if (res.ok) router.push("/trips")
  }

  return (
    <button className="btn-danger" onClick={remove}>
      Delete trip
    </button>
  )
}

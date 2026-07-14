import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTravelProvider } from "@/lib/providers"
import { flightSearchSchema } from "@/lib/validations"
import { persistFlightOffers } from "@/lib/quotes"
import { pickHighlights } from "@/lib/travel/flights"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const parsed = flightSearchSchema.safeParse({
    origin: sp.get("origin") ?? undefined,
    destination: sp.get("destination") ?? undefined,
    departDate: sp.get("departDate") ?? undefined,
    returnDate: sp.get("returnDate") ?? undefined,
    passengers: sp.get("passengers") ?? undefined,
    cabin: sp.get("cabin") ?? undefined,
    roundTrip: sp.get("roundTrip") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const provider = getTravelProvider().flights
    const raw = await provider.searchFlights(parsed.data)
    const offers = await persistFlightOffers(raw)
    const currency = offers[0]?.currency ?? "USD"
    const [priceHistory, nearbyAirports] = await Promise.all([
      provider.priceHistory(parsed.data.origin, parsed.data.destination, currency),
      provider.nearbyAirports(parsed.data, offers),
    ])
    return NextResponse.json({
      offers,
      highlights: pickHighlights(offers),
      priceHistory,
      nearbyAirports,
    })
  } catch (e) {
    console.error("flight search failed", e)
    return NextResponse.json({ error: "Flight search failed. Try again." }, { status: 502 })
  }
}

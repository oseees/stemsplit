import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTravelProvider } from "@/lib/providers"
import { hotelSearchSchema } from "@/lib/validations"
import { persistHotelOffers } from "@/lib/quotes"
import { bestValueHotel } from "@/lib/travel/hotels"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const parsed = hotelSearchSchema.safeParse({
    destination: sp.get("destination") ?? undefined,
    checkIn: sp.get("checkIn") ?? undefined,
    checkOut: sp.get("checkOut") ?? undefined,
    guests: sp.get("guests") ?? undefined,
    rooms: sp.get("rooms") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const provider = getTravelProvider().hotels
    const raw = await provider.searchHotels(parsed.data)
    const offers = await persistHotelOffers(raw, parsed.data.destination)
    const priceHistory = await provider.priceHistory(
      parsed.data.destination,
      offers[0]?.currency ?? "USD"
    )
    return NextResponse.json({
      offers,
      bestValueId: bestValueHotel(offers)?.id ?? null,
      priceHistory,
    })
  } catch (e) {
    console.error("hotel search failed", e)
    return NextResponse.json({ error: "Hotel search failed. Try again." }, { status: 502 })
  }
}

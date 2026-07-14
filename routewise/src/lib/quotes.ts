import { prisma } from "./prisma"
import type { Cabin, FlightOffer, HotelOffer } from "./providers/types"
import type { FlightQuote, HotelQuote } from "@prisma/client"

// Stable signatures so repeated searches reuse rows instead of growing the table.
const flightSig = (o: FlightOffer) =>
  [o.provider, o.origin, o.destination, o.departAt, o.flightNumber, o.cabin, o.price, o.stops].join("|")

const hotelSig = (o: HotelOffer) =>
  [o.provider, o.name, o.nightlyPrice, o.nights, o.stars, o.distanceKm].join("|")

// Persist offers and return them tagged with their DB id (used by compare/select).
export async function persistFlightOffers(offers: FlightOffer[]): Promise<FlightOffer[]> {
  return Promise.all(
    offers.map(async (o) => {
      const row = await prisma.flightQuote.upsert({
        where: { sig: flightSig(o) },
        update: {},
        create: {
          sig: flightSig(o),
          provider: o.provider,
          origin: o.origin,
          destination: o.destination,
          departAt: new Date(o.departAt),
          arriveAt: new Date(o.arriveAt),
          durationMin: o.durationMin,
          stops: o.stops,
          layovers: o.layovers,
          airlineCode: o.airlineCode,
          airlineName: o.airlineName,
          flightNumber: o.flightNumber,
          cabin: o.cabin,
          baggage: o.baggage,
          price: o.price,
          currency: o.currency,
        },
      })
      return { ...o, id: row.id }
    })
  )
}

export async function persistHotelOffers(offers: HotelOffer[], city: string): Promise<HotelOffer[]> {
  return Promise.all(
    offers.map(async (o) => {
      const row = await prisma.hotelQuote.upsert({
        where: { sig: hotelSig(o) },
        update: {},
        create: {
          sig: hotelSig(o),
          provider: o.provider,
          name: o.name,
          city,
          image: o.image,
          rating: o.rating,
          stars: o.stars,
          nightlyPrice: o.nightlyPrice,
          nights: o.nights,
          totalPrice: o.totalPrice,
          currency: o.currency,
          distanceKm: o.distanceKm,
          amenities: o.amenities,
          cancellation: o.cancellation,
        },
      })
      return { ...o, id: row.id }
    })
  )
}

export function flightQuoteToOffer(q: FlightQuote): FlightOffer {
  return {
    id: q.id,
    provider: q.provider,
    airlineCode: q.airlineCode,
    airlineName: q.airlineName,
    flightNumber: q.flightNumber,
    origin: q.origin,
    destination: q.destination,
    departAt: q.departAt.toISOString(),
    arriveAt: q.arriveAt.toISOString(),
    durationMin: q.durationMin,
    stops: q.stops,
    layovers: q.layovers,
    price: q.price,
    currency: q.currency,
    cabin: q.cabin as Cabin,
    baggage: q.baggage,
  }
}

export function hotelQuoteToOffer(q: HotelQuote): HotelOffer {
  return {
    id: q.id,
    provider: q.provider,
    name: q.name,
    image: q.image,
    rating: q.rating,
    stars: q.stars,
    nightlyPrice: q.nightlyPrice,
    currency: q.currency,
    nights: q.nights,
    totalPrice: q.totalPrice,
    distanceKm: q.distanceKm,
    amenities: q.amenities,
    cancellation: q.cancellation,
  }
}

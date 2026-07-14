// Static reference data + deterministic helpers shared by the mock providers.
// Kept small but realistic. Also seeded into the DB (Airport/Airline tables).

export type Airport = {
  code: string
  name: string
  city: string
  country: string
  lat: number
  lng: number
}

export const AIRPORTS: Airport[] = [
  { code: "LHR", name: "Heathrow", city: "London", country: "UK", lat: 51.47, lng: -0.4543 },
  { code: "LGW", name: "Gatwick", city: "London", country: "UK", lat: 51.1537, lng: -0.1821 },
  { code: "STN", name: "Stansted", city: "London", country: "UK", lat: 51.885, lng: 0.235 },
  { code: "LCY", name: "London City", city: "London", country: "UK", lat: 51.5053, lng: 0.0553 },
  { code: "LOS", name: "Murtala Muhammed", city: "Lagos", country: "Nigeria", lat: 6.5774, lng: 3.3212 },
  { code: "LIS", name: "Humberto Delgado", city: "Lisbon", country: "Portugal", lat: 38.7742, lng: -9.1342 },
  { code: "OPO", name: "Francisco Sá Carneiro", city: "Porto", country: "Portugal", lat: 41.2481, lng: -8.6814 },
  { code: "JFK", name: "John F. Kennedy", city: "New York", country: "USA", lat: 40.6413, lng: -73.7781 },
  { code: "EWR", name: "Newark", city: "New York", country: "USA", lat: 40.6895, lng: -74.1745 },
  { code: "LGA", name: "LaGuardia", city: "New York", country: "USA", lat: 40.7769, lng: -73.874 },
  { code: "CDG", name: "Charles de Gaulle", city: "Paris", country: "France", lat: 49.0097, lng: 2.5479 },
  { code: "ORY", name: "Orly", city: "Paris", country: "France", lat: 48.7233, lng: 2.3794 },
  { code: "DXB", name: "Dubai Intl", city: "Dubai", country: "UAE", lat: 25.2532, lng: 55.3657 },
  { code: "AMS", name: "Schiphol", city: "Amsterdam", country: "Netherlands", lat: 52.3105, lng: 4.7683 },
  { code: "BCN", name: "El Prat", city: "Barcelona", country: "Spain", lat: 41.2974, lng: 2.0833 },
  { code: "MAD", name: "Barajas", city: "Madrid", country: "Spain", lat: 40.4983, lng: -3.5676 },
  { code: "FCO", name: "Fiumicino", city: "Rome", country: "Italy", lat: 41.8003, lng: 12.2389 },
  { code: "ACC", name: "Kotoka", city: "Accra", country: "Ghana", lat: 5.6052, lng: -0.1668 },
]

export const AIRLINES: { code: string; name: string }[] = [
  { code: "BA", name: "British Airways" },
  { code: "TP", name: "TAP Air Portugal" },
  { code: "AF", name: "Air France" },
  { code: "KL", name: "KLM" },
  { code: "DL", name: "Delta" },
  { code: "EK", name: "Emirates" },
  { code: "IB", name: "Iberia" },
  { code: "VS", name: "Virgin Atlantic" },
]

export function haversineKm(a: Airport, b: Airport): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

// Resolve an IATA code or a city name to airports. City → all its airports.
export function resolveAirports(query: string): Airport[] {
  const q = query.trim().toLowerCase()
  const byCode = AIRPORTS.filter((a) => a.code.toLowerCase() === q)
  if (byCode.length) return byCode
  return AIRPORTS.filter((a) => a.city.toLowerCase() === q)
}

// Deterministic string hash → used to seed pseudo-random-but-stable mock data,
// so the same search always yields the same offers (and thus stable ids).
export function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Mulberry32 PRNG seeded from a number → repeatable sequences.
export function seededRng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

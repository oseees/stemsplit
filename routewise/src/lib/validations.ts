import { z } from "zod"

export const CATEGORIES = [
  "Flights",
  "Accommodation",
  "Food",
  "Transport",
  "Activities",
  "Shopping",
  "Accessories",
  "Miscellaneous",
] as const

export const registerSchema = z.object({
  name: z.string().min(2, "Name is too short"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
})

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

export const tripSchema = z
  .object({
    departureCity: z.string().min(1, "Required"),
    destination: z.string().min(1, "Required"),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    currency: z.string().min(1, "Required"),
    budget: z.coerce.number().positive("Budget must be positive"),
    travelers: z.coerce.number().int().min(1, "At least 1 traveler"),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  })

export const expenseSchema = z.object({
  amount: z.coerce.number().positive("Amount must be positive"),
  category: z.enum(CATEGORIES),
  date: z.coerce.date(),
  notes: z.string().max(500).optional().or(z.literal("")),
})

// ---- Phase 2: travel search ----

export const flightSearchSchema = z.object({
  origin: z.string().min(2, "Enter a departure airport or city"),
  destination: z.string().min(2, "Enter a destination"),
  departDate: z.string().min(1, "Pick a departure date"),
  returnDate: z.string().optional(),
  passengers: z.coerce.number().int().min(1).max(9).default(1),
  cabin: z.enum(["economy", "premium", "business", "first"]).default("economy"),
  // Query strings arrive as "true"/"false" — z.coerce.boolean would treat
  // "false" as truthy, so normalise explicitly.
  roundTrip: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
})

export const hotelSearchSchema = z.object({
  destination: z.string().min(2, "Enter a destination"),
  checkIn: z.string().min(1, "Pick a check-in date"),
  checkOut: z.string().min(1, "Pick a check-out date"),
  guests: z.coerce.number().int().min(1).max(16).default(2),
  rooms: z.coerce.number().int().min(1).max(8).default(1),
})

// Select endpoints receive the chosen offer; server persists it as a quote.
export const selectFlightSchema = z.object({
  provider: z.string(),
  airlineCode: z.string(),
  airlineName: z.string(),
  flightNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  departAt: z.string(),
  arriveAt: z.string(),
  durationMin: z.coerce.number().int(),
  stops: z.coerce.number().int(),
  layovers: z.array(z.string()).default([]),
  price: z.coerce.number().nonnegative(),
  currency: z.string(),
  cabin: z.string(),
  baggage: z.string(),
})

export const selectHotelSchema = z.object({
  provider: z.string(),
  name: z.string(),
  image: z.string(),
  city: z.string().default(""),
  rating: z.coerce.number(),
  stars: z.coerce.number().int(),
  nightlyPrice: z.coerce.number().nonnegative(),
  nights: z.coerce.number().int().min(1),
  totalPrice: z.coerce.number().nonnegative(),
  currency: z.string(),
  distanceKm: z.coerce.number(),
  amenities: z.array(z.string()).default([]),
  cancellation: z.string(),
})

export type FlightSearchQuery = z.infer<typeof flightSearchSchema>
export type HotelSearchQuery = z.infer<typeof hotelSearchSchema>

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>

// Coerced output (Date/number) — what handlers/onSubmit receive.
export type TripOutput = z.output<typeof tripSchema>
export type ExpenseOutput = z.output<typeof expenseSchema>

// Raw form values (strings from inputs) — z.coerce makes z.input unusable here.
export type TripForm = {
  departureCity: string
  destination: string
  startDate: string
  endDate: string
  currency: string
  budget: number | string
  travelers: number | string
}
export type ExpenseForm = {
  amount?: number | string
  category: (typeof CATEGORIES)[number]
  date: string
  notes?: string
}

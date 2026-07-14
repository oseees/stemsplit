# RouteWise ✈️

A full-stack travel budgeting app: plan trips, set a budget, log expenses by
category, and watch spending against the budget on a dashboard with charts.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · Prisma ·
PostgreSQL · Auth.js (NextAuth v5) · React Hook Form · Zod · Recharts.

## Features (Phase 1)

- **Auth** — register, login, logout, and route protection via middleware.
- **Dashboard** — upcoming trips, total budget, total spent, remaining, and a
  budget-progress bar, plus *spending by category* (pie) and *spending over
  time* (line) charts.
- **Trips** — create / edit / delete. Fields: departure city, destination,
  start & end date, currency, budget, travelers.
- **Expenses** — full CRUD per trip. Fields: amount, category, date, notes.
  Categories: Flights, Accommodation, Food, Transport, Activities, Shopping,
  Accessories, Miscellaneous.

## Getting started

```bash
cd routewise
npm install                 # runs `prisma generate` on postinstall
cp .env.example .env        # then edit DATABASE_URL and set AUTH_SECRET
npx auth secret             # or generate AUTH_SECRET yourself and paste it in

npm run db:push             # create tables in your Postgres database
npm run db:seed             # optional demo data (demo@routewise.app / password123)

npm run dev                 # http://localhost:3000
```

You need a running PostgreSQL instance. Point `DATABASE_URL` at it, e.g.
`postgresql://user:pass@localhost:5432/routewise?schema=public`.

## Project layout

```
prisma/schema.prisma        Data models (User, Trip, Expense, Category enum)
prisma/seed.ts              Demo data
src/lib/prisma.ts           Prisma client singleton
src/lib/auth.ts             Auth.js setup (Credentials + JWT sessions)
src/lib/auth.config.ts      Edge-safe auth config (used by middleware)
src/lib/validations.ts      Zod schemas shared by client forms and API routes
src/middleware.ts           Protects /dashboard and /trips
src/app/api/…               REST route handlers (register, trips, expenses)
src/app/(auth)/…            Login & register pages
src/app/(dashboard)/…       Dashboard, trips list, trip detail
src/components/…            Reusable UI (StatCard, charts, forms, cards)
```

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/register` | Create an account |
| GET/POST | `/api/trips` | List / create trips |
| GET/PATCH/DELETE | `/api/trips/:id` | Read / update / delete a trip |
| GET | `/api/expenses?tripId=` | Expenses for a trip |
| POST | `/api/expenses` | Create an expense |
| PATCH/DELETE | `/api/expenses/:id` | Update / delete an expense |

All routes require an authenticated session and enforce per-user ownership.

## Phase 2 — flight & hotel search

AI-ready travel search that compares options and estimates trip cost before
booking. Runs entirely on **mock providers** with realistic sample data; real
providers (Amadeus, Duffel, Skyscanner) drop in behind the same interfaces.

### Provider architecture

External travel APIs sit behind interfaces in
[`src/lib/providers/types.ts`](src/lib/providers/types.ts). Business logic and
UI depend only on these — never on a concrete provider.

```ts
interface FlightProvider {
  searchFlights(params: FlightSearchParams): Promise<FlightOffer[]>
  priceHistory(origin, destination, currency): Promise<PriceHistorySummary>
  nearbyAirports(params, offers): Promise<NearbyAirportSuggestion[]>
}
interface HotelProvider {
  searchHotels(params: HotelSearchParams): Promise<HotelOffer[]>
  priceHistory(destination, currency): Promise<PriceHistorySummary>
}
interface TravelProvider { flights: FlightProvider; hotels: HotelProvider }
```

`getTravelProvider()` in [`src/lib/providers/index.ts`](src/lib/providers/index.ts)
is the single swap point — return an Amadeus/Duffel implementation there and
nothing else changes. The mock lives in `src/lib/providers/mock/` and is
deterministic (seeded by the search params), so the same search yields stable
offers and ids.

### Business logic (pure + unit-tested)

`src/lib/travel/` holds framework-free functions covering the interesting
decisions — flight sort/filter/highlights, hotel sort/filter/value, budget
estimate + over-budget warnings. Tested with the built-in Node runner:

```bash
npm test    # tsx --test src/lib/travel/*.test.ts
```

### New models

`Airport`, `Airline`, `FlightQuote`, `HotelQuote`, `PriceHistory`,
`SelectedFlight`, `SelectedHotel`. Offers are persisted (deduped by a `sig`)
so compare/select can reference stable ids; a trip has at most one selected
flight and one selected hotel, which feed the live budget estimate.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/flights/search` | Search flights → `{ offers, highlights, priceHistory, nearbyAirports }`. Query: `origin, destination, departDate, returnDate?, passengers, cabin, roundTrip` |
| GET | `/api/flights/compare?ids=a,b,c` | Side-by-side of 2–3 previously-searched flight quotes |
| GET | `/api/hotels/search` | Search hotels → `{ offers, bestValueId, priceHistory }`. Query: `destination, checkIn, checkOut, guests, rooms` |
| GET | `/api/hotels/compare?ids=a,b,c` | Side-by-side of 2–3 hotel quotes |
| POST | `/api/trips/:id/select-flight` | Attach a flight offer to a trip; returns the updated budget estimate |
| POST | `/api/trips/:id/select-hotel` | Attach a hotel offer to a trip; returns the updated estimate |
| DELETE | `/api/trips/:id/select-flight` · `/select-hotel` | Remove the selection (frees its budget) |

All validate input with Zod and enforce per-user trip ownership. Pages:
[`/flights`](src/app/(dashboard)/flights) and [`/hotels`](src/app/(dashboard)/hotels).

## Notes / deferred

- Money is stored as `Float` — fine for Phase 1 budgeting; move to
  `Decimal`/integer-cents if rounding matters.
- Dashboard totals assume a single currency (shows the most common one). Add
  per-currency grouping or FX conversion when users mix currencies.
- Mock flight/hotel offers are priced in USD regardless of the trip currency,
  so the budget sidebar treats them 1:1. Add FX conversion when wiring a real
  provider.
- Nearby-airport savings surface when searching a *specific* airport (e.g.
  `LHR`); searching a city ("London") already includes all its airports.

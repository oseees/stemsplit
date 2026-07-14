import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { AIRPORTS, AIRLINES } from "../src/lib/providers/mock/data"

const prisma = new PrismaClient()

async function main() {
  // Reference data (idempotent).
  await prisma.airport.createMany({ data: AIRPORTS, skipDuplicates: true })
  await prisma.airline.createMany({ data: AIRLINES, skipDuplicates: true })

  const password = await bcrypt.hash("password123", 10)
  const user = await prisma.user.upsert({
    where: { email: "demo@routewise.app" },
    update: {},
    create: { name: "Demo Traveler", email: "demo@routewise.app", password },
  })

  // Only create the demo trip once so re-seeding stays idempotent.
  const existing = await prisma.trip.findFirst({ where: { userId: user.id } })
  if (!existing) {
    await prisma.trip.create({
      data: {
        userId: user.id,
        departureCity: "Lagos",
        destination: "Lisbon",
        startDate: new Date("2026-09-10"),
        endDate: new Date("2026-09-20"),
        currency: "EUR",
        budget: 2500,
        travelers: 2,
        expenses: {
          create: [
            { amount: 780, category: "Flights", date: new Date("2026-08-01") },
            { amount: 620, category: "Accommodation", date: new Date("2026-09-10") },
            { amount: 140, category: "Food", date: new Date("2026-09-11"), notes: "Dinner + market" },
            { amount: 60, category: "Transport", date: new Date("2026-09-12") },
            { amount: 95, category: "Activities", date: new Date("2026-09-13") },
          ],
        },
      },
    })
  }

  console.log(
    `Seeded ${AIRPORTS.length} airports, ${AIRLINES.length} airlines, user demo@routewise.app / password123`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

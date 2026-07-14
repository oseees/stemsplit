"use client"

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { tripSchema, type TripForm, type TripOutput } from "@/lib/validations"
import { toDateInput } from "@/lib/utils"

type Trip = {
  id: string
  departureCity: string
  destination: string
  startDate: string | Date
  endDate: string | Date
  currency: string
  budget: number
  travelers: number
}

const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "JPY", "CAD", "AUD", "ZAR", "INR"]

export default function TripDialog({
  trip,
  trigger,
}: {
  trip?: Trip
  trigger: string
}) {
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState("")
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TripForm, unknown, TripOutput>({
    resolver: zodResolver(tripSchema) as Resolver<TripForm, unknown, TripOutput>,
    defaultValues: trip
      ? {
          departureCity: trip.departureCity,
          destination: trip.destination,
          startDate: toDateInput(trip.startDate),
          endDate: toDateInput(trip.endDate),
          currency: trip.currency,
          budget: trip.budget,
          travelers: trip.travelers,
        }
      : { currency: "USD", travelers: 1 },
  })

  async function onSubmit(values: TripOutput) {
    setServerError("")
    const res = await fetch(trip ? `/api/trips/${trip.id}` : "/api/trips", {
      method: trip ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      setServerError("Could not save trip. Check the fields and try again.")
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button className={trip ? "btn-ghost" : "btn-primary"} onClick={() => setOpen(true)}>
        {trigger}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{trip ? "Edit trip" : "New trip"}</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
              <div className="col-span-1">
                <label className="label">From</label>
                <input className="field" placeholder="Lagos" {...register("departureCity")} />
                {errors.departureCity && <p className="err">{errors.departureCity.message}</p>}
              </div>
              <div className="col-span-1">
                <label className="label">Destination</label>
                <input className="field" placeholder="Lisbon" {...register("destination")} />
                {errors.destination && <p className="err">{errors.destination.message}</p>}
              </div>
              <div className="col-span-1">
                <label className="label">Start date</label>
                <input type="date" className="field" {...register("startDate")} />
                {errors.startDate && <p className="err">{errors.startDate.message}</p>}
              </div>
              <div className="col-span-1">
                <label className="label">End date</label>
                <input type="date" className="field" {...register("endDate")} />
                {errors.endDate && <p className="err">{errors.endDate.message}</p>}
              </div>
              <div className="col-span-1">
                <label className="label">Currency</label>
                <select className="field" {...register("currency")}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-1">
                <label className="label">Travelers</label>
                <input type="number" min={1} className="field" {...register("travelers")} />
                {errors.travelers && <p className="err">{errors.travelers.message}</p>}
              </div>
              <div className="col-span-2">
                <label className="label">Budget</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="field"
                  placeholder="2000"
                  {...register("budget")}
                />
                {errors.budget && <p className="err">{errors.budget.message}</p>}
              </div>

              {serverError && <p className="err col-span-2">{serverError}</p>}

              <div className="col-span-2 mt-2 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Save trip"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

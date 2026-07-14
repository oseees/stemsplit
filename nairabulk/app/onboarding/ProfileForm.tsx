"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { completeProfileSchema, type CompleteProfileInput } from "@/lib/validation"
import { NIGERIAN_STATES } from "@/lib/nigeria"
import { TextField } from "@/components/TextField"
import { completeProfileAction } from "./actions"

export default function ProfileForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompleteProfileInput>({ resolver: zodResolver(completeProfileSchema) })

  async function onSubmit(values: CompleteProfileInput) {
    setFormError(null)
    const res = await completeProfileAction(values)
    if (res.redirectTo) return router.push(res.redirectTo)
    setFormError(res.error ?? "Something went wrong")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700">Delivery state</label>
        <select
          defaultValue=""
          {...register("shippingState")}
          className={`mt-1 w-full rounded-md border px-3 py-3 text-base outline-none focus:ring-2 focus:ring-primary-500 ${
            errors.shippingState ? "border-red-400" : "border-gray-300"
          }`}
        >
          <option value="" disabled>
            Select a state
          </option>
          {NIGERIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {errors.shippingState && (
          <p className="mt-1 text-sm text-red-600">{errors.shippingState.message}</p>
        )}
      </div>
      <TextField
        label="City / town"
        autoComplete="address-level2"
        error={errors.shippingCity?.message}
        {...register("shippingCity")}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Continue"}
      </button>
    </form>
  )
}

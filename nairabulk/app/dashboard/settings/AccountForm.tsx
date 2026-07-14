"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { accountSchema, type AccountInput } from "@/lib/validation"
import { NIGERIAN_STATES } from "@/lib/nigeria"
import { TextField } from "@/components/TextField"
import { updateAccountAction } from "./actions"

export default function AccountForm({ initial }: { initial: AccountInput }) {
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AccountInput>({ resolver: zodResolver(accountSchema), defaultValues: initial })

  async function onSubmit(values: AccountInput) {
    setFormError(null)
    setSaved(false)
    const res = await updateAccountAction(values)
    if (res.success) return setSaved(true)
    if (res.field === "phone") setError("phone", { message: res.error })
    else setFormError(res.error ?? "Something went wrong")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
      )}
      {saved && (
        <p className="rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-800">
          Changes saved.
        </p>
      )}
      <TextField
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        error={errors.phone?.message}
        {...register("phone")}
      />
      <TextField
        label="Street address"
        autoComplete="address-line1"
        error={errors.shippingStreet?.message}
        {...register("shippingStreet")}
      />
      <TextField
        label="City / town"
        autoComplete="address-level2"
        error={errors.shippingCity?.message}
        {...register("shippingCity")}
      />
      <div>
        <label className="block text-sm font-medium text-gray-700">Delivery state</label>
        <select
          {...register("shippingState")}
          className={`mt-1 w-full rounded-md border px-3 py-3 text-base outline-none focus:ring-2 focus:ring-primary-500 ${
            errors.shippingState ? "border-red-400" : "border-gray-300"
          }`}
        >
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
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  )
}

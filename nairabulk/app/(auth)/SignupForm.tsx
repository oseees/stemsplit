"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signupSchema, type SignupInput } from "@/lib/validation"
import { TextField } from "@/components/TextField"
import { signUpAction } from "./actions"

export default function SignupForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) })

  async function onSubmit(values: SignupInput) {
    setFormError(null)
    const res = await signUpAction(values)
    if (res.redirectTo) return router.push(res.redirectTo)
    if (res.field === "phone") setError("phone", { message: res.error })
    else setFormError(res.error ?? "Something went wrong")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
      )}
      <TextField
        label="Full name"
        autoComplete="name"
        error={errors.fullName?.message}
        {...register("fullName")}
      />
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <TextField
        label="Phone number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0801 234 5678"
        error={errors.phone?.message}
        {...register("phone")}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary-700 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  )
}

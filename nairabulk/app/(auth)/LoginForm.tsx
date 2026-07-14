"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { loginSchema, type LoginInput } from "@/lib/validation"
import { TextField } from "@/components/TextField"
import { signInAction } from "./actions"

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginInput) {
    setFormError(null)
    const res = await signInAction(values, next)
    if (res.redirectTo) return router.push(res.redirectTo)
    setFormError(res.error ?? "Something went wrong")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
      )}
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-primary-600 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
      >
        {isSubmitting ? "Logging in…" : "Log in"}
      </button>
      <p className="text-center text-sm text-gray-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-primary-700 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  )
}

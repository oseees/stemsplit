"use client"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { loginSchema, type LoginInput } from "@/lib/validations"

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginInput) {
    setError("")
    const res = await signIn("credentials", { ...values, redirect: false })
    if (res?.error) {
      setError("Invalid email or password.")
      return
    }
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
      <p className="mb-6 text-slate-500">Log in to your RouteWise account.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="field" type="email" {...register("email")} />
          {errors.email && <p className="err">{errors.email.message}</p>}
        </div>
        <div>
          <label className="label">Password</label>
          <input className="field" type="password" {...register("password")} />
          {errors.password && <p className="err">{errors.password.message}</p>}
        </div>
        {error && <p className="err">{error}</p>}
        <button className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        No account?{" "}
        <Link href="/register" className="font-medium text-brand-700">
          Create one
        </Link>
      </p>
    </main>
  )
}

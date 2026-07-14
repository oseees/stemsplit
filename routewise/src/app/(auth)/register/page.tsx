"use client"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { registerSchema, type RegisterInput } from "@/lib/validations"

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) })

  async function onSubmit(values: RegisterInput) {
    setError("")
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error === "Email already registered" ? data.error : "Could not register.")
      return
    }
    // Auto login after successful registration.
    await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    })
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
      <p className="mb-6 text-slate-500">Start budgeting your next trip.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="field" {...register("name")} />
          {errors.name && <p className="err">{errors.name.message}</p>}
        </div>
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
          {isSubmitting ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700">
          Log in
        </Link>
      </p>
    </main>
  )
}

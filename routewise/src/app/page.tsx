import Link from "next/link"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function Home() {
  const session = await auth()
  if (session?.user) redirect("/dashboard")

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700">
        ✈️ Travel budgeting, minus the spreadsheets
      </span>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Know exactly what your next trip costs
      </h1>
      <p className="max-w-xl text-lg text-slate-600">
        RouteWise tracks every flight, hotel and coffee against a budget you set —
        so there are no surprises when you get home.
      </p>
      <div className="flex gap-3">
        <Link href="/register" className="btn-primary">
          Get started
        </Link>
        <Link href="/login" className="btn-ghost">
          Log in
        </Link>
      </div>
    </main>
  )
}

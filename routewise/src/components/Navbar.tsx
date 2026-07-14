"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trips", label: "Trips" },
  { href: "/flights", label: "Flights" },
  { href: "/hotels", label: "Hotels" },
  { href: "/ai", label: "AI" },
]

export default function Navbar({ name }: { name?: string | null }) {
  const path = usePathname()
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/dashboard" className="text-lg font-bold text-brand-700">
          ✈️ RouteWise
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                path.startsWith(l.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <span className="mx-2 hidden text-sm text-slate-400 sm:inline">{name}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="btn-ghost">
            Sign out
          </button>
        </nav>
      </div>
    </header>
  )
}

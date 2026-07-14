"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  Scissors,
  TrendingUp,
  Search,
  CreditCard,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/upload", label: "Upload", icon: Upload },
  { href: "/dashboard/clips", label: "Clips", icon: Scissors },
  { href: "/dashboard/competitor", label: "Competitor", icon: Search },
  { href: "/dashboard/trends", label: "Trend Center", icon: TrendingUp },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function Sidebar({ tier }: { tier: string }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-bg-border bg-bg-soft/50 p-4 md:flex">
      <Link href="/dashboard" className="px-2 text-lg font-semibold tracking-tight">
        ViralClip<span className="text-brand">AI</span>
      </Link>
      <span className="mt-1 px-2 text-xs uppercase tracking-wide text-white/40">
        {tier} plan
      </span>

      <nav className="mt-6 flex-1 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-brand-soft text-white" : "text-white/60 hover:bg-white/5",
              )}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>

      <form action="/auth/signout" method="post">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/50 transition hover:bg-white/5">
          <LogOut size={17} /> Sign out
        </button>
      </form>
    </aside>
  );
}

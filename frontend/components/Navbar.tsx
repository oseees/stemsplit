"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Music2, Zap, Crown } from "lucide-react";
import { isProUser, refreshProStatus } from "@/lib/api";

export default function Navbar() {
  const pathname = usePathname();
  const [pro, setPro] = useState(false);

  useEffect(() => {
    setPro(isProUser());
    // Re-verify against backend in case the license was refunded/revoked
    refreshProStatus().then(setPro).catch(() => {});
  }, [pathname]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <Music2 size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg gradient-text">StemSplit AI</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <Link href="/#pricing" className="text-sm text-white/60 hover:text-white transition-colors">Pricing</Link>
          <Link href="/dashboard" className={`text-sm transition-colors ${pathname === "/dashboard" ? "text-white" : "text-white/60 hover:text-white"}`}>Dashboard</Link>
          <Link href="/broiler" className={`text-sm transition-colors ${pathname === "/broiler" ? "text-white" : "text-white/60 hover:text-white"}`}>Broiler Sim</Link>
        </div>

        <div className="flex items-center gap-3">
          {pro ? (
            <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-card border border-purple-500/30 text-xs font-medium text-purple-300">
              <Crown size={13} /> Pro
            </span>
          ) : (
            <Link href="/upgrade" className="hidden sm:flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors">
              <Crown size={14} /> Upgrade
            </Link>
          )}
          <Link href="/upload" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all text-sm font-medium shadow-lg shadow-purple-500/20">
            <Zap size={14} />
            Upload Track
          </Link>
        </div>
      </div>
    </nav>
  );
}

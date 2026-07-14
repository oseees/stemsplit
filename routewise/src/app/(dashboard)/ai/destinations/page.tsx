import Link from "next/link"
import DestinationSearch from "@/components/ai/DestinationSearch"

export default function DestinationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/ai" className="text-sm text-slate-500 hover:text-brand-700">← AI Dashboard</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Destination Explorer</h1>
        <p className="text-slate-500 mt-0.5">
          Describe your dream trip in plain language and get personalised destination suggestions with cost estimates.
        </p>
      </div>
      <DestinationSearch />
    </div>
  )
}

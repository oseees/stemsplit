import Link from "next/link"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth"
import { NIGERIAN_STATES } from "@/lib/nigeria"
import AccountForm from "./AccountForm"

export const metadata = { title: "Account settings — NairaBulk" }

export default async function SettingsPage() {
  const session = await getSessionUser()
  if (!session?.profile) redirect("/login")
  const { profile } = session

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <Link href="/dashboard" className="text-sm text-primary-700 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Account settings</h1>
      <p className="mt-1 text-sm text-gray-500">Update your phone and delivery address.</p>

      <div className="mt-6">
        <AccountForm
          initial={{
            phone: profile.phone,
            shippingStreet: profile.shippingStreet ?? "",
            shippingCity: profile.shippingCity ?? "",
            shippingState:
              (profile.shippingState as (typeof NIGERIAN_STATES)[number]) ??
              NIGERIAN_STATES[0],
          }}
        />
      </div>
    </div>
  )
}

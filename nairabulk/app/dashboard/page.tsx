import Link from "next/link"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth"
import { signOutAction } from "../(auth)/actions"

export const metadata = { title: "Dashboard — NairaBulk" }

export default async function DashboardPage() {
  const session = await getSessionUser()
  if (!session) redirect("/login")
  const { profile } = session

  // Nudge users who skipped the delivery step.
  if (profile && !profile.shippingState) redirect("/onboarding")

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        Hi{profile?.fullName ? `, ${profile.fullName.split(" ")[0]}` : ""} 👋
      </h1>
      <p className="mt-1 text-gray-500">Welcome to your NairaBulk dashboard.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          href="/campaigns"
          className="rounded-lg border border-gray-200 p-4 hover:border-primary-300"
        >
          <p className="font-semibold">Browse campaigns</p>
          <p className="text-sm text-gray-500">Find a group buy to join.</p>
        </Link>
        <Link
          href="/dashboard/settings"
          className="rounded-lg border border-gray-200 p-4 hover:border-primary-300"
        >
          <p className="font-semibold">Account settings</p>
          <p className="text-sm text-gray-500">Update your delivery details.</p>
        </Link>
      </div>

      <form action={signOutAction} className="mt-8">
        <button className="text-sm font-medium text-gray-500 hover:text-gray-800">
          Log out
        </button>
      </form>
    </div>
  )
}

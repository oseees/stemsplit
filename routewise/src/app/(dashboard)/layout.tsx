import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Navbar from "@/components/Navbar"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="min-h-screen">
      <Navbar name={session.user.name} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}

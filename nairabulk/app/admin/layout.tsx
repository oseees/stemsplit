import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth"

// Authoritative admin gate: role comes from the DB, not a client-editable claim.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser()
  if (!session) redirect("/login?next=/admin")
  if (session.profile?.role !== "ADMIN") redirect("/dashboard")
  return <>{children}</>
}

import { createClient } from "./supabase/server"
import { prisma } from "./prisma"

// Current authenticated user + their profile row (or null if signed out).
export async function getSessionUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const profile = await prisma.user.findUnique({ where: { id: user.id } })
  return { user, profile }
}

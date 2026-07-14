import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

const PROTECTED = ["/dashboard", "/onboarding", "/admin"]

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const needsAuth = PROTECTED.some((p) => pathname.startsWith(p))
  if (needsAuth && !user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/admin") && user) {
    // ponytail: optimistic gate off user_metadata; app/admin/layout.tsx re-checks
    // role against the DB — that's the real security boundary, this is just a fast bounce.
    const role = (user.user_metadata as { role?: string } | undefined)?.role
    if (role !== "ADMIN") {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
}

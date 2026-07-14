import NextAuth from "next-auth"
import { authConfig } from "@/lib/auth.config"

export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  matcher: ["/dashboard/:path*", "/trips/:path*", "/flights/:path*", "/hotels/:path*", "/ai/:path*"],
}

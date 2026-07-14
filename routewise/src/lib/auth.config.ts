import type { NextAuthConfig } from "next-auth"

// Edge-safe config (no Prisma/bcrypt here) — shared by middleware and the full auth setup.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isProtected =
        nextUrl.pathname.startsWith("/dashboard") ||
        nextUrl.pathname.startsWith("/trips") ||
        nextUrl.pathname.startsWith("/flights") ||
        nextUrl.pathname.startsWith("/hotels") ||
        nextUrl.pathname.startsWith("/ai")
      if (isProtected) return isLoggedIn
      return true
    },
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string
      return session
    },
  },
  providers: [], // real providers are added in auth.ts
} satisfies NextAuthConfig

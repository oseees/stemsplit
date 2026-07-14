import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "RouteWise — Travel Budgeting",
  description: "Plan trips and track your travel spending in one place.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

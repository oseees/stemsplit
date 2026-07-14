import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViralClip AI — Turn long videos into viral shorts",
  description:
    "AI-powered clip detection, viral intelligence, and retention analysis for TikTok, YouTube Shorts and Instagram Reels.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}

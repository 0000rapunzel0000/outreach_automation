import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Outreach Team", description: "Outreach team onboarding and LinkedIn connection monitoring" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

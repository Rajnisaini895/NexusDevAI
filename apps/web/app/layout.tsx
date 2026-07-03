import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexusDev AI | Developer Intelligence",
  description:
    "A connected engineering intelligence workspace for modern teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

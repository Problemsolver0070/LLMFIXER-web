import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Fixer — light emerges where atoms meet",
  description:
    "A model-agnostic LLM optimization layer. Context-on-Demand cuts token use ~70-90% while preserving perfect recall.",
  metadataBase: new URL("https://thefixer.in"),
  openGraph: {
    title: "The Fixer",
    description:
      "A model-agnostic LLM optimization layer. Context-on-Demand cuts token use ~70-90%.",
    siteName: "The Fixer",
    url: "https://thefixer.in",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0E1A",
  // Lock pinch-zoom so the cosmos canvas + atmospheric backdrop never
  // detach from the visual viewport on iOS (where zoom + position:fixed
  // produce dark gaps around the canvas). The cosmos is the experience —
  // OS-level accessibility zoom still works for users who need it.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

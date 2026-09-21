import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/app/theme-provider";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://denis.hacimertgokhan.com";
const DESCRIPTION =
  "Hosted Denis databases: a lightweight key-value and SQL engine that keeps data in memory and journals every write. Web console, REST API, Node.js client and a hosted MCP endpoint for AI assistants. Free plan, open source.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "Denis Cloud — hosted key-value and SQL databases with MCP", template: "%s · Denis Cloud" },
  description: DESCRIPTION,
  applicationName: "Denis Cloud",
  keywords: [
    "Denis",
    "database",
    "key-value store",
    "in-memory database",
    "SQL",
    "MCP server",
    "Model Context Protocol",
    "AI assistant database",
    "Redis alternative",
    "hosted database",
  ],
  authors: [{ name: "Hacı Mert Gökhan", url: "https://github.com/hacimertgokhan" }],
  creator: "Hacı Mert Gökhan",
  category: "technology",
  alternates: { canonical: "/", languages: { en: "/" } },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Denis Cloud",
    url: "/",
    title: "Denis Cloud — a database you talk to one line at a time",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Denis Cloud", description: DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { email: false, telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

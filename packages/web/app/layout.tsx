import { Analytics } from "@vercel/analytics/react"
import { RootProvider } from "fumadocs-ui/provider/next"
import type { Metadata } from "next"
import { Outfit } from "next/font/google"
import Script from "next/script"
import "./global.css"

const primary = Outfit({
  subsets: ["latin"],
  variable: "--font-primary",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Arctic - AI-Powered Terminal Interface",
    template: "%s | Arctic",
  },
  description:
    "Arctic is a multi-provider AI coding interface with TUI and CLI capabilities. Build, debug, and ship faster with AI-powered tools in your terminal.",
  keywords: [
    "arctic",
    "AI TUI",
    "AI CLI",
    "terminal interface",
    "coding assistant",
    "developer tools",
    "AI coding",
    "terminal AI",
    "command line AI",
    "multi-provider AI",
    "code generation",
    "AI development tools",
    "TUI",
  ],
  authors: [{ name: "Arctic Team" }],
  creator: "Arctic Team",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://usearctic.sh",
    title: "Arctic - AI-Powered Terminal Interface",
    description:
      "Multi-provider AI coding interface with TUI and CLI capabilities. Build, debug, and ship faster with AI-powered tools in your terminal.",
    siteName: "Arctic",
  },
  twitter: {
    card: "summary_large_image",
    title: "Arctic - AI-Powered Terminal Interface",
    description: "Multi-provider AI coding interface with TUI and CLI capabilities. Build, debug, and ship faster.",
    creator: "@usearctic",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
}

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={primary.variable} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
      <Script src="https://scripts.simpleanalyticscdn.com/latest.js" />
    </html>
  )
}

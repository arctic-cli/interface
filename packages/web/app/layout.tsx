import { Analytics } from "@vercel/analytics/react"
import { RootProvider } from "fumadocs-ui/provider/next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import type { Metadata } from "next"
import Script from "next/script"
import { ToastProvider } from "@/components/ui/toast"
import "./global.css"

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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ defaultTheme: "dark" }}>
          <ToastProvider>{children}</ToastProvider>
        </RootProvider>
        <Analytics />
      </body>
      <Script src="https://scripts.simpleanalyticscdn.com/latest.js" />
    </html>
  )
}

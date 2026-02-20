"use client"

import Image from "next/image"
import Link from "next/link"
import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTheme } from "next-themes"

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Toggle theme"
    >
      <HugeiconsIcon icon={Sun01Icon} className="h-5 w-5 hidden dark:block" />
      <HugeiconsIcon icon={Moon02Icon} className="h-5 w-5 dark:hidden" />
    </button>
  )
}

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50 shadow-sm">
      <div className="mx-auto max-w-7xl px-6 md:px-16">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Image src="/arctic-logo.png" alt="Arctic Logo" width={32} height={32} className="w-8 h-8" />
            <span className="text-xl font-semibold tracking-tight text-foreground group-hover:text-foreground/80 transition-colors">
              Arctic
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <Link
              href="/docs"
              className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Documentation
            </Link>
            <Link
              href="https://github.com/arctic-cli/interface"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </Link>
            <Link
              href="https://discord.gg/B4HqXxNynG"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Discord
            </Link>
            <ThemeToggle />
          </div>

          <div className="md:hidden flex items-center gap-4">
            <Link
              href="/docs"
              className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  )
}

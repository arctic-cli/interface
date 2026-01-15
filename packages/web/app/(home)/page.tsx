import {
  AmpCodeIcon,
  AntigravityIcon,
  ClaudeCodeIcon,
  CodexIcon,
  CopilotIcon,
  GeminiIcon,
  KimiIcon,
  MinimaxIcon,
  QwenIcon,
  ZaiIcon,
} from "@/components/provider-icons"
import { GridBackground } from "@/components/ui/grid-background"
import { ChartHistogramIcon, CodeIcon, FlashIcon, Globe02Icon, LockPasswordIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Redis } from "@upstash/redis"
import { InstallSelector } from "./install-selector"
import { Navbar } from "./navbar"
import { WaitlistForm } from "./waitlist-form"

type WaitlistState = {
  status: "idle" | "success" | "invalid" | "duplicate" | "error"
  message: string
}

async function joinWaitlist(_prevState: WaitlistState, formData: FormData): Promise<WaitlistState> {
  "use server"

  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "invalid", message: "Enter a valid email address." }
  }

  try {
    const redis = Redis.fromEnv()
    const added = await redis.sadd("waitlist:emails", email)

    if (added === 1) {
      await redis.incr("waitlist:total")
      return { status: "success", message: "You're on the waitlist." }
    }

    return { status: "duplicate", message: "You're already on the waitlist." }
  } catch (error) {
    console.error("Waitlist signup error:", error)
    return { status: "error", message: "Something went wrong. Please try again." }
  }
}

export default function HomePage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden antialiased relative">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden md:block">
        <div className="absolute inset-y-0 left-16 w-px bg-[hsl(0,4%,23%)]" />
        <div className="absolute inset-y-0 right-16 w-px bg-[hsl(0,4%,23%)]" />
      </div>
      <Navbar />
      <GridBackground className="relative">
        <section className="pt-32 pb-16 md:pt-48 md:pb-20 relative z-10">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col items-center text-center space-y-12 px-6 md:px-16">
              <div className="space-y-6 max-w-4xl">
                <h1 className="text-5xl md:text-7xl font-semibold tracking-tight text-foreground/95 leading-[0.95] md:leading-[0.95]">
                  Arctic
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground/90 font-normal tracking-tight leading-relaxed">
                  Open source AI coding agent focused on model and provider fast switching and usage limit tracking.
                </p>
              </div>

              <div className="relative z-20 w-full max-w-2xl">
                <InstallSelector />
              </div>

              <div className="space-y-6 w-full max-w-4xl">
                <p className="text-sm text-muted-foreground/80 uppercase tracking-wider font-medium">
                  Supports all major AI coding plans
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <CopilotIcon />
                    <span className="text-sm font-medium">Copilot</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <AntigravityIcon />
                    <span className="text-sm font-medium">Antigravity</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <CodexIcon />
                    <span className="text-sm font-medium">Codex</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <ClaudeCodeIcon />
                    <span className="text-sm font-medium">Claude Code</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <GeminiIcon />
                    <span className="text-sm font-medium">Gemini CLI</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <KimiIcon />
                    <span className="text-sm font-medium">Kimi</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <ZaiIcon />
                    <span className="text-sm font-medium">Z.ai</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <AmpCodeIcon />
                    <span className="text-sm font-medium">Amp Code</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <QwenIcon />
                    <span className="text-sm font-medium">Qwen</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background/80 border border-border/50">
                    <MinimaxIcon />
                    <span className="text-sm font-medium">Minimax</span>
                  </div>
                </div>
              </div>

              <div className="w-full mt-8">
                <div className="rounded-2xl overflow-hidden border border-border/50 shadow-2xl shadow-black/5">
                  <video
                    src="/arctic.mp4"
                    autoPlay
                    playsInline
                    loop
                    muted
                    preload="auto"
                    className="w-full h-auto block"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              </div>
            </div>
          </div>
        </section>
      </GridBackground>

      <div className="px-6 md:px-16">
        <div className="h-px w-full bg-[hsl(0,4%,23%)]" />
      </div>

      <section className="py-32">
        <div className="mx-auto max-w-7xl 2xl:px-0 px-8">
          <div className="space-y-12 px-6 md:px-16">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">FAQ</h2>
              <p className="text-lg text-muted-foreground">Common questions about Arctic.</p>
            </div>
            <div className="space-y-8">
              <div className="flex gap-4 items-start">
                <HugeiconsIcon className="size-6 text-foreground shrink-0 mt-1" icon={FlashIcon} />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Can I switch between different accounts?</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Yes. Switch instantly between personal and enterprise accounts, or between different AI providers,
                    without leaving your terminal.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <HugeiconsIcon className="size-6 text-foreground shrink-0 mt-1" icon={ChartHistogramIcon} />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Can I see my usage limits while coding?</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Yes. Arctic displays real-time usage limits, quotas, and remaining requests for all your AI
                    subscriptions directly in your terminal.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <HugeiconsIcon className="size-6 text-foreground shrink-0 mt-1" icon={LockPasswordIcon} />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Is my code private?</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Yes. Arctic runs entirely on your machine. No proxies, no data collection, no training on your code.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <HugeiconsIcon className="size-6 text-foreground shrink-0 mt-1" icon={Globe02Icon} />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Which AI providers does Arctic support?</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Arctic supports coding plans like Claude Code, Codex, Gemini, GitHub Copilot, Antigravity, Z.ai,
                    Kimi, and Amp Code. For API access, Arctic supports 75+ providers including Anthropic, OpenAI,
                    Google, OpenRouter, Groq, DeepSeek, and any OpenAI-compatible endpoint.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <HugeiconsIcon className="size-6 text-foreground shrink-0 mt-1" icon={CodeIcon} />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Where does Arctic run?</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Arctic is a terminal-based AI coding agent. Run it directly in your terminal on Linux, macOS, or
                    Windows.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl 2xl:px-0 px-8">
          <div className="space-y-6 px-6 md:px-16">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              What makes Arctic different from OpenCode?
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              While OpenCode focuses on being an open source AI coding agent, Arctic is built specifically for
              developers who need to manage multiple AI subscriptions and accounts. Arctic lets you switch between
              personal and enterprise accounts, see your usage limits in real-time, and track your spending across all
              providers without leaving your terminal.
            </p>
          </div>
        </div>
      </section>

      <div className="px-6 md:px-16">
        <div className="h-px w-full bg-[hsl(0,4%,23%)]" />
      </div>

      <GridBackground className="">
        <section className="py-32">
          <div className="mx-auto max-w-7xl">
            <div className="text-center space-y-8 px-6 md:px-16">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Join the waitlist.</h2>
              <p className="text-lg text-muted-foreground">
                Get early access updates and release notes straight to your inbox.
              </p>
              <WaitlistForm action={joinWaitlist} />
            </div>
          </div>
        </section>
      </GridBackground>
    </div>
  )
}

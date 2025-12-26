import Image from "next/image"
import { CopyButton } from "./copy-button"
import { buttonVariants } from "@/components/ui/button"
import { Book, Github } from "lucide-react"
import Link from "next/link"

export default function HomePage() {
  const installCommand = "curl -fsSL https://arcticli.com/install | sh"

  return (
    <div className="relative min-h-screen w-full">
      {/* Full Background Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/forest.png"
          alt="Arctic Forest"
          fill
          className="object-cover"
          priority
          quality={100}
          sizes="100vw"
        />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 flex min-h-screen w-full">
        {/* Spacer for Left Side - allows image to be fully visible here */}
        <div className="hidden lg:block lg:w-1/2" />

        {/* Right Side - Content */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center px-8 md:px-16 lg:px-24 bg-fd-background border-l border-fd-border/50 shadow-2xl">
          <div className="max-w-xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            
            {/* Header */}
            <div className="space-y-4">
               <div className="relative w-16 h-16 mb-6">
                  <Image src="/arctic-logo.png" alt="Arctic Logo" fill className="object-contain" />
               </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-fd-foreground">
                Arctic
              </h1>
              <p className="text-xl md:text-2xl text-fd-muted-foreground">
                The multi-provider AI coding CLI.
              </p>
            </div>

            {/* Description */}
            <p className="text-lg text-fd-muted-foreground/80 leading-relaxed">
              Unified limits, sessions, and tools in your terminal. 
              Switch seamlessly between Codex, Gemini, Anthropic, and GitHub Copilot 
              without changing your workflow.
            </p>

            {/* Install Command */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-fd-muted-foreground uppercase tracking-wider">
                Get Started
              </div>
              <CopyButton command={installCommand} />
            </div>

            {/* Links */}
            <div className="flex flex-wrap gap-4 pt-4 border-t border-fd-border/50">
              <Link href="/docs" className={buttonVariants({ size: "lg" })}>
                <Book className="size-4" />
                Documentation
              </Link>
              <Link href="https://github.com/arctic-cli/cli" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                <Github className="size-4" />
                GitHub
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

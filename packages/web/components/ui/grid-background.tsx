interface GridBackgroundProps {
  children: React.ReactNode
  className?: string
}

export function GridBackground({ children, className }: GridBackgroundProps) {
  return (
    <div className={className}>
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          backgroundImage:
            "linear-gradient(oklch(from var(--foreground) l c h / 0.06) 1px, transparent 1px), linear-gradient(90deg, oklch(from var(--foreground) l c h / 0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 60% 22% at 50% 24%, black 0%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 22% at 50% 24%, black 0%, transparent 100%)",
        }}
      />

      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          backgroundImage:
            "linear-gradient(oklch(from var(--foreground) l c h / 0.03) 1px, transparent 1px), linear-gradient(90deg, oklch(from var(--foreground) l c h / 0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 60% 22% at 50% 24%, black 0%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 22% at 50% 24%, black 0%, transparent 100%)",
        }}
      />

      <div className="relative">{children}</div>
    </div>
  )
}

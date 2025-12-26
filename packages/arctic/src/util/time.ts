export namespace Time {
  /**
   * Format milliseconds into a human-readable duration string
   * Examples:
   * - 1500 -> "1s"
   * - 65000 -> "1m 5s"
   * - 3665000 -> "1h 1m"
   */
  export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      const remainingMinutes = minutes % 60
      if (remainingMinutes > 0) {
        return `${hours}h ${remainingMinutes}m`
      }
      return `${hours}h`
    }

    if (minutes > 0) {
      const remainingSeconds = seconds % 60
      if (remainingSeconds > 0) {
        return `${minutes}m ${remainingSeconds}s`
      }
      return `${minutes}m`
    }

    if (seconds > 0) {
      return `${seconds}s`
    }

    return "0s"
  }
}

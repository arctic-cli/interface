/**
 * CLI utilities for Antigravity OAuth authentication
 *
 * Provides command-line prompts and user interaction for multi-account setup.
 */

/**
 * Prompts user to add more accounts or start fresh.
 * Used during OAuth flow to support multi-account configuration.
 *
 * @returns "add" to add more accounts, "fresh" to start over, or null to continue
 */
export async function promptAddMoreAccounts(): Promise<"add" | "fresh" | null> {
  // TODO: Implement interactive prompt
  // For now, return null (single account mode)
  return null;
}

/**
 * Displays account count and status to the user.
 *
 * @param count - Number of accounts configured
 */
export function displayAccountCount(count: number): void {
  if (count === 0) {
    console.log("[arctic-antigravity-auth] No accounts configured.");
  } else if (count === 1) {
    console.log("[arctic-antigravity-auth] 1 account configured.");
  } else {
    console.log(`[arctic-antigravity-auth] ${count} accounts configured.`);
  }
}

/**
 * Prompts user for Google Cloud project ID during OAuth flow.
 *
 * @returns Project ID or undefined to skip
 */
export async function promptForProjectId(): Promise<string | undefined> {
  // TODO: Implement interactive prompt
  // For now, return undefined (auto-discover project ID)
  return undefined;
}

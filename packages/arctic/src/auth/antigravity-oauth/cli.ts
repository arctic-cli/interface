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
  return null
}

import type { PluginInput } from "@arctic-cli/plugin"

/**
 * Handles the interactive login flow for Antigravity.
 * This launches the OAuth flow via the plugin's auth method.
 */
export async function handleAntigravityLogin() {
  const { ArcticAntigravityAuth } = await import("./index")
  // Create a minimal plugin input context
  const plugin = await ArcticAntigravityAuth({
    client: {
      tui: { showToast: async () => {} },
    } as any,
  } as PluginInput)

  if (!plugin.auth) {
    throw new Error("Antigravity auth plugin failed to initialize")
  }

  // Find the OAuth method
  const oauthMethod = plugin.auth.methods.find((m) => m.type === "oauth")
  if (!oauthMethod || !oauthMethod.authorize) {
    throw new Error("Antigravity OAuth method not found")
  }

  // Execute the authorization flow
  const authorize = await oauthMethod.authorize({})

  if (authorize.instructions) {
    console.log(authorize.instructions)
  }

  if (authorize.callback) {
    // @ts-ignore
    const result = await authorize.callback()
    if (result.type === "success") {
      console.log("Login successful")
    } else {
      console.error("Login failed")
    }
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
  return undefined
}

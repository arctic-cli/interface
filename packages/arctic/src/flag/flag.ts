export namespace Flag {
  export const ARCTIC_GIT_BASH_PATH = process.env["ARCTIC_GIT_BASH_PATH"]
  export const ARCTIC_CONFIG = process.env["ARCTIC_CONFIG"]
  export const ARCTIC_CONFIG_DIR = process.env["ARCTIC_CONFIG_DIR"]
  export const ARCTIC_CONFIG_CONTENT = process.env["ARCTIC_CONFIG_CONTENT"]
  export const ARCTIC_DISABLE_AUTOUPDATE = truthy("ARCTIC_DISABLE_AUTOUPDATE")
  export const ARCTIC_DISABLE_PRUNE = truthy("ARCTIC_DISABLE_PRUNE")
  export const ARCTIC_PERMISSION = process.env["ARCTIC_PERMISSION"]
  export const ARCTIC_DISABLE_DEFAULT_PLUGINS = truthy("ARCTIC_DISABLE_DEFAULT_PLUGINS")
  export const ARCTIC_DISABLE_LSP_DOWNLOAD = truthy("ARCTIC_DISABLE_LSP_DOWNLOAD")
  export const ARCTIC_ENABLE_EXPERIMENTAL_MODELS = truthy("ARCTIC_ENABLE_EXPERIMENTAL_MODELS")
  export const ARCTIC_DISABLE_AUTOCOMPACT = truthy("ARCTIC_DISABLE_AUTOCOMPACT")
  export const ARCTIC_FAKE_VCS = process.env["ARCTIC_FAKE_VCS"]
  export const ARCTIC_CLIENT = process.env["ARCTIC_CLIENT"] ?? "cli"

  // Experimental
  export const ARCTIC_EXPERIMENTAL = truthy("ARCTIC_EXPERIMENTAL")
  export const ARCTIC_EXPERIMENTAL_ICON_DISCOVERY =
    ARCTIC_EXPERIMENTAL || truthy("ARCTIC_EXPERIMENTAL_ICON_DISCOVERY")
  export const ARCTIC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("ARCTIC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const ARCTIC_ENABLE_EXA =
    truthy("ARCTIC_ENABLE_EXA") || ARCTIC_EXPERIMENTAL || truthy("ARCTIC_EXPERIMENTAL_EXA")
  export const ARCTIC_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("ARCTIC_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const ARCTIC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ARCTIC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase()
    return value === "true" || value === "1"
  }

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

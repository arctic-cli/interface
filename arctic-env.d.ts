/**
 * Arctic-specific environment bindings used by the CLI runtime.
 * This replaces the old SST-generated declarations and keeps only
 * the secrets the CLI still references directly.
 */
declare module "sst" {
  export interface Resource {
    ADMIN_SECRET: {
      type: "sst.sst.Secret"
      value: string
    }
    GITHUB_APP_ID: {
      type: "sst.sst.Secret"
      value: string
    }
    GITHUB_APP_PRIVATE_KEY: {
      type: "sst.sst.Secret"
      value: string
    }
  }
}

import "sst"
export {}

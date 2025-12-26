export * from "./client.js"
export * from "./server.js"

import { createArcticClient } from "./client.js"
import { createArcticServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createArctic(options?: ServerOptions) {
  const server = await createArcticServer({
    ...options,
  })

  const client = createArcticClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

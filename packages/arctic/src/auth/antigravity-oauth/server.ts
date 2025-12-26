import http from "node:http";

// Embedded success HTML to avoid filesystem issues in bundled apps
const successHtml = "Login successful. You can close this window.";

export interface OAuthServerInfo {
  port: number;
  close: () => void;
  waitForCallback: () => Promise<{ code: string; state: string } | null>;
}

/**
 * Start a small local HTTP server that waits for /oauth-callback and returns the code + state
 * @returns Promise that resolves to server info
 */
export function startLocalOAuthServer(): Promise<OAuthServerInfo> {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/oauth-callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.statusCode = 400;
        res.end("Missing authorization code or state");
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(successHtml);

      (server as http.Server & { _lastCallback?: { code: string; state: string } })._lastCallback = { code, state };
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });

  return new Promise((resolve) => {
    server
      .listen(51121, "127.0.0.1", () => {
        resolve({
          port: 51121,
          close: () => server.close(),
          waitForCallback: async () => {
            const poll = () => new Promise<void>((r) => setTimeout(r, 100));
            // Wait up to 60 seconds
            for (let i = 0; i < 600; i++) {
              const lastCallback = (server as http.Server & { _lastCallback?: { code: string; state: string } })._lastCallback;
              if (lastCallback) return lastCallback;
              await poll();
            }
            return null;
          },
        });
      })
      .on("error", (err: NodeJS.ErrnoException) => {
        console.error(
          "[arctic-antigravity-auth] Failed to bind http://127.0.0.1:51121 (",
          err?.code,
          ") Falling back to manual paste.",
        );
        resolve({
          port: 51121,
          close: () => {
            try {
              server.close();
            } catch {}
          },
          waitForCallback: async () => null,
        });
      });
  });
}

/**
 * Bun server for MeticAI 3.0.0 (proxy mode).
 *
 * Request routing (first match wins):
 *   1. WebSocket upgrade on /api/ws/live  -> live telemetry hub
 *   2. /api/v1/*                          -> transparent reverse proxy to machine
 *   3. /api/*                             -> @metic/core handle(req, platform)
 *   4. everything else                    -> static frontend (SPA fallback)
 *
 * The same core `handle()` runs here and in the browser; the only difference is
 * the Platform implementation injected (node vs browser).
 */

import type { Server, ServerWebSocket } from "bun";
import { handle } from "@metic/core";
import type { Platform } from "@metic/core/platform";
import { createNodePlatform } from "./platform/node.ts";
import { isMachinePath, proxyToMachine } from "./machineProxy.ts";
import { createStaticServer } from "./static.ts";
import { TelemetryHub, type TelemetryClient } from "./telemetryHub.ts";
import { handleTailscaleRoutes } from "./tailscale.ts";

const LIVE_WS_PATH = "/api/ws/live";

interface WsData {
  client: TelemetryClient;
}

export interface CreateServerOptions {
  port?: number;
  hostname?: string;
  platform?: Platform;
  /** Directory containing the built frontend (index.html + assets). */
  staticDir?: string;
}

export function createServer(options: CreateServerOptions = {}): Server<WsData> {
  const platform = options.platform ?? createNodePlatform();
  const staticDir =
    options.staticDir ?? process.env.STATIC_DIR ?? `${process.cwd()}/frontend/dist`;
  const serveStatic = createStaticServer(staticDir);
  const hub = new TelemetryHub(platform.machine.getBaseUrl(), platform.logger);

  const server = Bun.serve<WsData>({
    port: options.port ?? Number(process.env.PORT ?? 3550),
    hostname: options.hostname ?? "0.0.0.0",
    idleTimeout: 0, // telemetry sockets stay open indefinitely

    async fetch(request: Request, srv: Server<WsData>): Promise<Response | undefined> {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === LIVE_WS_PATH) {
        const client: TelemetryClient = {
          send: () => {
            /* replaced once the socket is open; see websocket.open */
          },
        };
        const upgraded = srv.upgrade(request, { data: { client } });
        if (upgraded) return undefined;
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      if (isMachinePath(pathname)) {
        return proxyToMachine(request, platform);
      }

      if (pathname === "/health") {
        return handle(new Request(new URL("/api/health", url).toString()), platform);
      }

      if (pathname.startsWith("/api/")) {
        // Host-specific Tailscale routes (unix-socket LocalAPI + settings) are
        // served here, not in the host-agnostic core.
        const tailscale = await handleTailscaleRoutes(request, platform);
        if (tailscale) return tailscale;
        return handle(request, platform);
      }

      // The Bun server IS the frontend origin, so the app must talk to it via
      // same-origin relative URLs. Override the build-time config.json (which
      // ships a dev serverUrl) with an empty serverUrl. Mirrors the behaviour
      // the legacy nginx deployment provided.
      if (pathname === "/config.json") {
        return new Response(JSON.stringify({ serverUrl: "" }), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
        });
      }

      return serveStatic(pathname);
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const client: TelemetryClient = {
          send: (data) => {
            try {
              ws.send(data);
            } catch {
              /* client gone; hub prunes on next broadcast */
            }
          },
        };
        ws.data.client = client;
        hub.addClient(client);
      },
      message() {
        // Client -> server messages are not part of the telemetry protocol.
      },
      close(ws: ServerWebSocket<WsData>) {
        if (ws.data.client) hub.removeClient(ws.data.client);
      },
    },
  });

  platform.logger.info("metic server listening", {
    port: server.port,
    machine: platform.machine.getBaseUrl() || "(unconfigured)",
    staticDir,
  });

  return server;
}

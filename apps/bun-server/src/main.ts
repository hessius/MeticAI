/**
 * Entrypoint for the MeticAI Bun server.
 *
 * Subcommands:
 *   serve        Start the HTTP/WebSocket server (default).
 *   healthcheck  Probe a running server's /health and exit 0/1
 *                (used as the container HEALTHCHECK).
 */

import { createServer } from "./server.ts";
import { rollbackSqliteMigration } from "./platform/sqliteMigration.ts";
import { join } from "node:path";

async function healthcheck(): Promise<number> {
  const port = Number(process.env.PORT ?? 3550);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`healthcheck failed: HTTP ${res.status}`);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error("healthcheck failed:", err instanceof Error ? err.message : err);
    return 1;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";

  switch (command) {
    case "serve": {
      createServer();
      // Bun.serve keeps the process alive; nothing further to do.
      return;
    }
    case "healthcheck": {
      process.exit(await healthcheck());
      break;
    }
    case "storage-rollback": {
      // Reverse a SQLite boot migration: drop metic.db and restore the
      // flat-JSON *.bak originals (issue #531). Idempotent.
      const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
      const did = rollbackSqliteMigration(dataDir, (m) => console.log(m));
      console.log(
        did
          ? "storage rollback complete"
          : "no SQLite migration to roll back (no stamp found)",
      );
      process.exit(0);
      break;
    }
    default: {
      console.error(
        `Unknown command: ${command}\nUsage: metic-server [serve|healthcheck|storage-rollback]`,
      );
      process.exit(2);
    }
  }
}

void main();

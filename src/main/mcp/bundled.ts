import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { log } from '../logger.js';

const BUNDLED_WEB_SEARCH_ID = 'bundled-web-search';
const BUNDLED_PARSE_DOCUMENT_ID = 'bundled-parse-document';

/**
 * Resolve the path to a bundled resource directory in both dev and packaged
 * (asar) builds. In a packaged Electron app, `process.resourcesPath` points
 * to the app's `Resources/` dir; in dev we resolve relative to this file.
 */
function resolveBundledResourcePath(...segments: string[]): string {
  // Try packaged location first.
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', ...segments)
    : null;
  if (packaged && fs.existsSync(packaged)) return packaged;

  const packagedNoUnpack = process.resourcesPath
    ? path.join(process.resourcesPath, 'resources', ...segments)
    : null;
  if (packagedNoUnpack && fs.existsSync(packagedNoUnpack)) return packagedNoUnpack;

  // Dev: walk up from compiled out/main/mcp/bundled.js or src/main/mcp/bundled.ts
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', '..', '..', 'resources', ...segments),
      path.resolve(here, '..', '..', 'resources', ...segments),
      path.resolve(process.cwd(), 'resources', ...segments),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0];
  } catch {
    return path.resolve(process.cwd(), 'resources', ...segments);
  }
}

/**
 * Idempotently insert a row for the bundled web-search MCP server. Uses a
 * fixed id so re-running is safe (INSERT OR IGNORE).
 */
export function seedBundledMcpServers(db: Database.Database): void {
  try {
    const existing = db
      .prepare('SELECT id FROM mcp_servers WHERE id = ?')
      .get(BUNDLED_WEB_SEARCH_ID);
    if (!existing) {
      const indexJs = resolveBundledResourcePath(
        'mcp-servers',
        'web-search',
        'index.js',
      );
      const config = {
        command: process.execPath,
        args: [indexJs],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      };
      db.prepare(
        'INSERT OR IGNORE INTO mcp_servers (id,name,transport,config_json,enabled,created_at) VALUES (?,?,?,?,?,?)',
      ).run(
        BUNDLED_WEB_SEARCH_ID,
        'Web Search (bundled)',
        'stdio',
        JSON.stringify(config),
        0,
        Date.now(),
      );
      log.info({ indexJs }, 'seeded bundled web-search MCP server');
    }

    const existingPd = db
      .prepare('SELECT id FROM mcp_servers WHERE id = ?')
      .get(BUNDLED_PARSE_DOCUMENT_ID);
    if (!existingPd) {
      const pdIndexJs = resolveBundledResourcePath(
        'mcp-servers',
        'parse-document',
        'index.js',
      );
      // db.name is the filesystem path the better-sqlite3 connection was
      // opened with — reuse it so the child mcp process reads the same file.
      const dbPath = (db as unknown as { name: string }).name;
      const pdConfig = {
        command: process.execPath,
        args: [pdIndexJs],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SIDEPAD_DB_PATH: dbPath,
        },
      };
      db.prepare(
        'INSERT OR IGNORE INTO mcp_servers (id,name,transport,config_json,enabled,created_at) VALUES (?,?,?,?,?,?)',
      ).run(
        BUNDLED_PARSE_DOCUMENT_ID,
        'Parse Document (bundled)',
        'stdio',
        JSON.stringify(pdConfig),
        1,
        Date.now(),
      );
      log.info({ pdIndexJs, dbPath }, 'seeded bundled parse-document MCP server');
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'failed to seed bundled MCP server');
  }
}

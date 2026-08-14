#!/usr/bin/env node
/**
 * Find the embedded browser panel and hand back a live Playwright connection.
 *
 * The port is never hard-coded: the app picks a free one per session and writes
 * it to a discovery file, which this reads. Every layer is verified before it is
 * trusted — a file left behind by a crash points at a port some *other* process
 * may now own, and connecting to that blind is how an agent ends up driving a
 * stranger's browser.
 *
 *   node scripts/browser-cdp.mjs            # print what was found
 *   node scripts/browser-cdp.mjs --json     # machine-readable
 *
 * As a module:
 *   import { readDiscovery, connect } from "./scripts/browser-cdp.mjs";
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Must match `identifier` in src-tauri/tauri.conf.json. */
const BUNDLE_ID = "app.orvoton.micah";
const DISCOVERY_FILE = "browser-cdp.json";
const SCHEMA = 1;

/** Where Tauri's `app_data_dir()` lands, per platform. */
export function discoveryPath() {
  // Lets a validation run point at an app instance started with an isolated
  // app-data dir, so proving the feature does not require closing the one the
  // user is working in.
  if (process.env.MICAH_APP_DATA_DIR) {
    return path.join(process.env.MICAH_APP_DATA_DIR, BUNDLE_ID, DISCOVERY_FILE);
  }
  const home = homedir();
  if (process.platform === "win32") {
    const roaming =
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(roaming, BUNDLE_ID, DISCOVERY_FILE);
  }
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      BUNDLE_ID,
      DISCOVERY_FILE,
    );
  }
  const dataHome =
    process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(dataHome, BUNDLE_ID, DISCOVERY_FILE);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and validate the discovery file. Throws with a reason rather than
 * returning something half-trusted.
 */
export function readDiscovery({ requirePid = true } = {}) {
  const file = discoveryPath();
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `no browser panel discovery file at ${file} — is Micah running with the browser panel enabled?`,
    );
  }

  let info;
  try {
    info = JSON.parse(raw);
  } catch (e) {
    throw new Error(`discovery file at ${file} is not valid JSON: ${e}`);
  }

  if (info.schema !== SCHEMA) {
    throw new Error(
      `discovery file schema ${info.schema} is not the ${SCHEMA} this script understands`,
    );
  }
  if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) {
    throw new Error(`discovery file has no usable port: ${info.port}`);
  }
  if (typeof info.ws_endpoint !== "string" || !info.ws_endpoint.startsWith("ws")) {
    throw new Error(`discovery file has no usable ws endpoint`);
  }
  // A dead pid means the file outlived the app — the port may since have been
  // handed to something else entirely.
  if (requirePid && !pidAlive(info.pid)) {
    throw new Error(
      `discovery file names pid ${info.pid}, which is not running — stale file from a crashed session`,
    );
  }
  return { ...info, file };
}

/** Confirm the port still answers *and* still belongs to a Chromium. */
export async function probe(port, { timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (typeof body.webSocketDebuggerUrl !== "string") {
      throw new Error("no webSocketDebuggerUrl — that port is not a CDP endpoint");
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Connect Playwright to the panel and return `{ browser, context, page, info }`.
 * `page` is the panel's visible page, not a fresh tab — driving it is what makes
 * the human and the agent look at the same thing.
 */
export async function connect({ playwright } = {}) {
  const info = readDiscovery();
  const version = await probe(info.port);
  const { chromium } = playwright ?? (await import("playwright"));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.port}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("connected, but the panel exposed no browser context");
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, context, page, info, version };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const json = process.argv.includes("--json");
  try {
    const info = readDiscovery();
    const version = await probe(info.port);
    const out = { ...info, version };
    if (json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`discovery file : ${info.file}`);
      console.log(`window         : ${info.window_label}`);
      console.log(`app pid        : ${info.pid}`);
      console.log(`cdp            : http://127.0.0.1:${info.port}`);
      console.log(`ws             : ${info.ws_endpoint}`);
      console.log(`browser        : ${version.Browser ?? "?"}`);
    }
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}

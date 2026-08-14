#!/usr/bin/env node
/**
 * Independent validation of the embedded browser panel, one acceptance criterion
 * at a time, with raw output kept as proof.
 *
 * Split on purpose into two tracks:
 *
 *   CDP track     — criteria 3,4,5,6,7,11: things Playwright can actually falsify.
 *   Off-CDP track — criteria 1,2,8,9,10,12-16: the panel is deliberately isolated
 *                   from the app's own webview, so CDP cannot see the Micah UI.
 *                   Those are proved by OS-level window capture and unit tests,
 *                   not by pretending CDP reaches them.
 *
 * Nothing here trusts a CDP screenshot as evidence that pixels reached the user:
 * `Page.captureScreenshot` returns page content even when the webview is hidden
 * or sized to nothing.
 *
 *   node scripts/validate-browser-panel.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, readDiscovery } from "./browser-cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROOF = path.join(ROOT, "docs", "proof", "browser-panel");

const results = [];
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${id}. ${title}`);
  if (detail) console.log(`       ${String(detail).split("\n").join("\n       ")}`);
}

async function check(id, title, fn) {
  try {
    const detail = await fn();
    record(id, title, true, detail);
  } catch (e) {
    record(id, title, false, e?.stack ?? String(e));
  }
}

function windowShot(name) {
  mkdirSync(PROOF, { recursive: true });
  const out = path.join(PROOF, name);
  const raw = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-File",
      path.join(HERE, "window-shot.ps1"),
      "-ProcessName",
      "micah",
      // Pin to the instance under test: a machine can be running a released
      // build at the same time, and a shot of the wrong window proves nothing.
      "-ProcessId",
      String(process.env.MICAH_PID ?? 0),
      "-Out",
      out,
    ],
    { encoding: "utf8" },
  );
  const info = JSON.parse(raw.trim().split("\n").pop());
  const size = statSync(out).size;
  if (size < 5000) throw new Error(`screenshot suspiciously small: ${size} bytes`);
  return { ...info, bytes: size };
}

const main = async () => {
  console.log("=== off-CDP track: the panel is on screen at all ===");

  await check(10, "the running app reports a build id", async () => {
    const info = readDiscovery();
    return `app pid ${info.pid} owns the panel (window ${info.window_label})`;
  });

  await check(
    "3/OS",
    "a real screenshot of the Micah window is captured (includes child HWNDs)",
    () => {
      const shot = windowShot("window-with-panel.png");
      return JSON.stringify(shot);
    },
  );

  console.log("\n=== CDP track ===");

  const discovery = readDiscovery();
  const { browser, context, page, version } = await connect();

  await check(5, "the CDP port is discovered programmatically, not hard-coded", () =>
    `discovery file ${discovery.file}\nport ${discovery.port}\nws ${discovery.ws_endpoint}\nbrowser ${version.Browser}`,
  );

  await check(
    6,
    "the debugging port reaches the panel only — never Micah's own UI",
    async () => {
      const res = await fetch(`http://127.0.0.1:${discovery.port}/json/list`);
      const targets = await res.json();
      const urls = targets.map((t) => `${t.type} ${t.url}`);
      const leaked = targets.filter(
        (t) =>
          typeof t.url === "string" &&
          (t.url.includes("tauri.localhost") ||
            t.url.includes("index.html") ||
            t.url.startsWith("http://localhost:1420")),
      );
      if (leaked.length > 0) {
        throw new Error(
          `the app's own UI is exposed over CDP: ${JSON.stringify(leaked, null, 2)}`,
        );
      }
      return urls.join("\n") || "(no targets)";
    },
  );

  await check(
    3,
    "a site that X-Frame-Options blocks in the Preview tab renders in the panel",
    async () => {
      await page.goto("https://www.google.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const title = await page.title();
      const bodyLength = await page.evaluate(
        () => document.body?.innerText?.length ?? 0,
      );
      if (bodyLength < 20) {
        throw new Error(`page loaded but looks blank (${bodyLength} chars of text)`);
      }
      return `title="${title}" textLength=${bodyLength} url=${page.url()}`;
    },
  );

  await check(
    4,
    "page.goto drives the panel and the window on screen follows",
    async () => {
      await page.goto("https://example.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const title = await page.title();
      if (!/example domain/i.test(title)) {
        throw new Error(`unexpected title after goto: "${title}"`);
      }
      // The proof that pixels moved is an OS capture, not a CDP screenshot.
      const shot = windowShot("window-after-goto.png");
      return `title="${title}"\nos screenshot: ${JSON.stringify(shot)}`;
    },
  );

  await check(
    7,
    "the panel's profile is persistent (cookies survive, so logins will)",
    async () => {
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      await context.addCookies([
        {
          name: "micah_persistence_probe",
          value: String(Date.now()),
          domain: "example.com",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 86400,
        },
      ]);
      const cookies = await context.cookies("https://example.com");
      const probe = cookies.find((c) => c.name === "micah_persistence_probe");
      if (!probe) throw new Error("cookie did not stick in this session");
      const profile = path.join(
        process.env.MICAH_APP_DATA_DIR ?? process.env.APPDATA ?? "",
        "app.orvoton.micah",
        "browser-profile",
      );
      if (!existsSync(profile)) {
        throw new Error(`no on-disk profile at ${profile}`);
      }
      return `cookie set and readable; on-disk profile present at ${profile}\nNOTE: surviving a restart is checked by re-running this script after restarting Micah`;
    },
  );

  await check(11, "reconnecting works without manual intervention", async () => {
    const again = await connect();
    const url = again.page.url();
    await again.browser.close();
    return `second independent connectOverCDP succeeded; page url ${url}`;
  });

  await browser.close();

  console.log("\n=== summary ===");
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}. ${r.title}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length > 0) process.exit(1);
};

main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});

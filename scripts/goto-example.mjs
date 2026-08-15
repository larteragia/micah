import { chromium } from "playwright";
import { readDiscovery } from "./browser-cdp.mjs";
const d = await readDiscovery();
const b = await chromium.connectOverCDP(d.ws_endpoint ?? `http://127.0.0.1:${d.port}`);
const page = b.contexts()[0].pages()[0];
console.log(JSON.stringify({ before: page.url() }));
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(JSON.stringify({ after_goto: page.url() }));
await b.close();

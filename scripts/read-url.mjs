import { chromium } from "playwright";
import { readDiscovery } from "./browser-cdp.mjs";
const d = await readDiscovery();
const b = await chromium.connectOverCDP(d.ws_endpoint ?? `http://127.0.0.1:${d.port}`);
const page = b.contexts()[0].pages()[0];
console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
await b.close();

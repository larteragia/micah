# The embedded browser panel

A real Chromium living inside the Micah window, on the left of a draggable split,
with a debugging port open so Playwright can drive the very page the human is
looking at.

## What it is, and what it is not

It is **not** the *Preview* tab. Preview is an `<iframe>` inside the app's own
webview: `X-Frame-Options: DENY` and `frame-ancestors` blank it out, and nothing
can automate it. The panel is a **child webview** — a separate Chromium with its
own process, its own profile and its own cookie jar. Third-party sites load
normally, logins survive restarts, and the Chrome DevTools Protocol is available.

| | Preview tab | Browser panel |
|---|---|---|
| Renders `X-Frame-Options: DENY` sites | no | yes |
| Session survives app restart | no | yes |
| Playwright can drive it | no | yes |
| Extra binary shipped | — | none (WebView2 is already a requirement) |

## Driving it from an agent

The port changes every session, so nothing hard-codes it. The app writes a
discovery file and `scripts/browser-cdp.mjs` reads it:

```bash
node scripts/browser-cdp.mjs          # what is running right now
node scripts/browser-cdp.mjs --json   # same, machine-readable
```

```js
import { connect } from "./scripts/browser-cdp.mjs";

const { page } = await connect();
await page.goto("https://example.com");   // the Micah window follows along
console.log(await page.title());
```

The discovery file lives beside the app's data (`%APPDATA%\app.orvoton.micah\browser-cdp.json`
on Windows) and carries `{schema, port, ws_endpoint, pid, started_at, window_label}`.
The reader refuses a file whose `pid` is dead and a port that does not answer
`/json/version` — a file left behind by a crash points at a port some other
process may since have taken.

## Security: read this before logging into anything

The debugging port is the feature. It is also, unavoidably, a control channel:

- **Any process running as you can take the panel over.** CDP has no
  authentication. The port is bound to `127.0.0.1` and is not hard-coded, but it
  is scannable in seconds. The discovery file is a convenience, *not* a control.
- **Session cookies are readable.** `Network.getAllCookies` hands over every
  cookie in the panel, and the profile on disk stores them in the clear — that is
  the price of "stay logged in across restarts".
- **The channel reaches the filesystem.** `Browser.setDownloadBehavior` writes
  files; a hostile client could navigate and evaluate at will. Navigation is
  restricted to `http`/`https`/`about` precisely to keep the *panel* away from
  `file:`, `javascript:` and `asset:`, but CDP itself is not fenced by that.
- **Browsing history is visible** to anything attached, continuously.

Use the panel with accounts you accept exposing to any code you run on this
machine. Turn it off (`micah.browser.enabled` → `0`) when that is not acceptable:
the webview is destroyed, the port closes and the discovery file is removed.

The panel's profile is deliberately **not** the app's own webview profile. On
Windows a distinct user-data folder means a distinct browser process, so the
debugging port reaches the panel and never Micah's own UI — that isolation is
load-bearing, not incidental.

## Implementation notes

- **One panel per process.** WebView2 refuses two environments with different
  browser arguments over one user-data folder, so a second window asking for the
  panel gets a legible error instead of a silent half-attach.
- **The native webview paints above the DOM.** It is a sibling HWND: it ignores
  `overflow: hidden` and `border-radius` on `#root`, and any overlay crossing its
  region would render behind it. Every overlay in the app is enumerated in
  `src/modules/browser/lib/suppression.ts`, and the webview hides while one is up.
  The bridge exposes that state, so an agent does not screenshot a hidden panel
  and believe the blank frame.
- **Dragging the divider hides the panel.** A native child webview swallows
  `pointermove`, which would freeze the drag mid-gesture; the placeholder carries
  the drag and the webview returns on `pointerup`.
- **Zoom is measured, not assumed.** The panel lives under `zoom: var(--app-zoom)`,
  and Chromium versions disagree on whether `getBoundingClientRect()` already
  includes it. `zoomScaleFor` (`src/modules/browser/lib/bounds.ts`) calibrates
  against the viewport instead of guessing.
- **`--remote-allow-origins` is deliberately absent.** It only relaxes the
  `Origin` check on the CDP WebSocket handshake; Playwright sends no such header,
  and `*` would let any web page on the machine seize the panel.
- **macOS and Linux** get the panel but no bridge: WebKit exposes no CDP. The
  flag defaults to off there and the reason is shown in the panel.

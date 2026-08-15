/**
 * Bookmarks and history for the browser panel: the pure logic.
 *
 * Everything here is a plain function over plain data, tested in vitest; the
 * store plumbing lives in `useCollections.ts`. Two stores on purpose — history
 * takes an append per navigation and `tauri-plugin-store` rewrites the whole
 * file on every save, so it must not share a file with bookmark icons.
 */

export type Bookmark = {
  id: string;
  url: string;
  title: string;
  /** PNG bytes, base64, or null when the site had no readable favicon. */
  iconPng: string | null;
};

export type HistoryEntry = {
  /** Monotonic insertion order. NOT a timestamp: wall clocks step. */
  seq: number;
  url: string;
  title: string;
  /** Milliseconds since epoch, display only — never used for ordering. */
  at: number;
};

export const HISTORY_CAP = 500;
/** Above this, the icon is dropped and the letter tile takes over: the store
 *  rewrites whole-file on save, and a rogue 2MB "favicon" would tax every
 *  bookmark mutation forever. */
export const ICON_MAX_BASE64_LENGTH = 88_000; // ~64KB of PNG

/**
 * Query parameters that carry credentials. A URL entering the history (or the
 * restore key) with one of these gets the value struck, not the page lost:
 * the entry stays useful, the secret does not outlive the redirect.
 */
const CREDENTIAL_PARAMS = [
  "access_token",
  "id_token",
  "refresh_token",
  "token",
  "auth",
  "authorization",
  "api_key",
  "apikey",
  "key",
  "secret",
  "client_secret",
  "code",
  "password",
  "senha",
  "otp",
  "magic",
  "session",
  "sid",
  "ticket",
  "assertion",
];

export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let touched = false;
  for (const name of [...url.searchParams.keys()]) {
    if (CREDENTIAL_PARAMS.includes(name.toLowerCase())) {
      url.searchParams.set(name, "redacted");
      touched = true;
    }
  }
  // Userinfo in the URL is a credential wherever it appears.
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    touched = true;
  }
  return touched ? url.toString() : raw;
}

/** Push a visit. Coalesces a repeat of the newest entry instead of stacking
 *  duplicates, redacts credentials, enforces the cap, keeps seq monotonic. */
export function pushHistory(
  entries: readonly HistoryEntry[],
  url: string,
  at: number,
): HistoryEntry[] {
  const clean = redactUrl(url);
  if (!/^https?:/.test(clean)) return [...entries];
  const newest = entries[entries.length - 1];
  if (newest && newest.url === clean) return [...entries];
  const seq = (newest?.seq ?? 0) + 1;
  const next = [...entries, { seq, url: clean, title: "", at }];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Titles arrive after navigations; attach one to the newest matching entry. */
export function titleHistory(
  entries: readonly HistoryEntry[],
  url: string,
  title: string,
): HistoryEntry[] {
  const clean = redactUrl(url);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].url === clean) {
      if (entries[i].title === title) return [...entries];
      const next = [...entries];
      next[i] = { ...next[i], title };
      return next;
    }
  }
  return [...entries];
}

/** What survives a reload of a possibly hand-edited or corrupted store. */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: HistoryEntry[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as HistoryEntry).url === "string" &&
      typeof (item as HistoryEntry).seq === "number"
    ) {
      const entry = item as HistoryEntry;
      entries.push({
        seq: entry.seq,
        url: entry.url,
        title: typeof entry.title === "string" ? entry.title : "",
        at: typeof entry.at === "number" ? entry.at : 0,
      });
    }
  }
  entries.sort((a, b) => a.seq - b.seq);
  return entries.slice(-HISTORY_CAP);
}

export function sanitizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const out: Bookmark[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Bookmark).id === "string" &&
      typeof (item as Bookmark).url === "string"
    ) {
      const b = item as Bookmark;
      out.push({
        id: b.id,
        url: b.url,
        title: typeof b.title === "string" ? b.title : b.url,
        iconPng:
          typeof b.iconPng === "string" && b.iconPng.length <= ICON_MAX_BASE64_LENGTH
            ? b.iconPng
            : null,
      });
    }
  }
  return out;
}

/** Add or refresh a bookmark. One entry per URL: saving the page again
 *  updates its title and icon rather than growing a duplicate. */
export function upsertBookmark(
  list: readonly Bookmark[],
  input: { url: string; title: string | null; iconPng: string | null },
): Bookmark[] {
  const url = redactUrl(input.url);
  const title = input.title?.trim() || hostOf(url) || url;
  const iconPng =
    input.iconPng && input.iconPng.length <= ICON_MAX_BASE64_LENGTH
      ? input.iconPng
      : null;
  const existing = list.findIndex((b) => b.url === url);
  if (existing >= 0) {
    const next = [...list];
    next[existing] = { ...next[existing], title, iconPng: iconPng ?? next[existing].iconPng };
    return next;
  }
  const id = `bm-${url.length}-${hashOf(url)}`;
  return [...list, { id, url, title, iconPng }];
}

export function removeBookmark(list: readonly Bookmark[], id: string): Bookmark[] {
  return list.filter((b) => b.id !== id);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The letter-tile fallback: first character of the host, deterministic hue. */
export function tileFor(url: string): { letter: string; hue: number } {
  const host = hostOf(url) || "?";
  return { letter: host[0].toUpperCase(), hue: hashOf(host) % 360 };
}

function hashOf(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Maps a Micah conversation onto a Claude Code CLI session.
 *
 * This mapping is the whole point of the provider: with a live session id the
 * CLI keeps the transcript on its side, so each turn ships only the new user
 * message instead of re-sending the entire history. That is the difference
 * between paying for the conversation once and paying for it again every turn.
 */

const STORAGE_KEY = "micah.claudeCode.sessions";
const MAX_TRACKED = 200;

type SessionMap = Record<string, string>;

let cache: SessionMap | null = null;

function load(): SessionMap {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as SessionMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map: SessionMap): void {
  cache = map;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private mode or quota — sessions simply stop surviving reloads.
  }
}

/** FNV-1a; only needs to be stable and cheap, never cryptographic. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A conversation key that survives every later turn: the first user message
 * never changes once a chat exists, so it identifies the chat by itself.
 */
export function conversationKey(firstUserText: string): string {
  return `${hash(firstUserText)}-${firstUserText.length.toString(36)}`;
}

export function getSessionId(key: string): string | null {
  return load()[key] ?? null;
}

export function setSessionId(key: string, sessionId: string): void {
  const map = { ...load(), [key]: sessionId };
  const keys = Object.keys(map);
  if (keys.length > MAX_TRACKED) {
    for (const k of keys.slice(0, keys.length - MAX_TRACKED)) delete map[k];
  }
  persist(map);
}

export function forgetSession(key: string): void {
  const map = { ...load() };
  delete map[key];
  persist(map);
}

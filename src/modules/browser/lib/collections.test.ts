import { describe, expect, it } from "vitest";
import {
  HISTORY_CAP,
  ICON_MAX_BASE64_LENGTH,
  type HistoryEntry,
  pushHistory,
  redactUrl,
  removeBookmark,
  sanitizeBookmarks,
  sanitizeHistory,
  tileFor,
  titleHistory,
  upsertBookmark,
} from "./collections";

describe("redactUrl", () => {
  it("strikes credential query parameters, keeping the page", () => {
    const out = redactUrl("https://a.com/cb?code=SECRET&state=xyz");
    expect(out).toContain("code=redacted");
    expect(out).toContain("state=xyz");
  });

  it("is case-insensitive on parameter names", () => {
    expect(redactUrl("https://a.com/?Access_Token=abc")).toContain(
      "Access_Token=redacted",
    );
  });

  it("drops userinfo credentials", () => {
    expect(redactUrl("https://user:pass@a.com/x")).toBe("https://a.com/x");
  });

  it("leaves clean urls and junk untouched", () => {
    expect(redactUrl("https://a.com/x?q=hello")).toBe("https://a.com/x?q=hello");
    expect(redactUrl("not a url")).toBe("not a url");
  });
});

describe("pushHistory", () => {
  it("appends with monotonic seq and redacts", () => {
    let h: HistoryEntry[] = [];
    h = pushHistory(h, "https://a.com/?token=x", 100);
    h = pushHistory(h, "https://b.com/", 200);
    expect(h.map((e) => e.seq)).toEqual([1, 2]);
    expect(h[0].url).toContain("token=redacted");
  });

  it("coalesces a repeat of the newest entry", () => {
    let h: HistoryEntry[] = [];
    h = pushHistory(h, "https://a.com/", 1);
    h = pushHistory(h, "https://a.com/", 2);
    expect(h).toHaveLength(1);
  });

  it("refuses non-web schemes", () => {
    expect(pushHistory([], "about:blank", 1)).toHaveLength(0);
    expect(pushHistory([], "file:///etc/passwd", 1)).toHaveLength(0);
  });

  it("caps and keeps seq rising past the cap", () => {
    let h: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      h = pushHistory(h, `https://a.com/${i}`, i);
    }
    expect(h).toHaveLength(HISTORY_CAP);
    expect(h[h.length - 1].seq).toBe(HISTORY_CAP + 10);
  });
});

describe("titleHistory", () => {
  it("titles the newest matching entry only", () => {
    let h: HistoryEntry[] = [];
    h = pushHistory(h, "https://a.com/", 1);
    h = pushHistory(h, "https://b.com/", 2);
    h = titleHistory(h, "https://a.com/", "Site A");
    expect(h[0].title).toBe("Site A");
    expect(h[1].title).toBe("");
  });
});

describe("sanitize", () => {
  it("drops junk history and restores order and cap", () => {
    const raw = [
      { seq: 2, url: "https://b.com/", title: "B", at: 2 },
      { seq: 1, url: "https://a.com/", title: 3, at: "x" },
      "garbage",
      null,
      { url: "no-seq" },
    ];
    const h = sanitizeHistory(raw);
    expect(h.map((e) => e.url)).toEqual(["https://a.com/", "https://b.com/"]);
    expect(h[0].title).toBe("");
    expect(sanitizeHistory("not an array")).toEqual([]);
  });

  it("drops junk bookmarks and oversized icons", () => {
    const raw = [
      { id: "1", url: "https://a.com/", title: "A", iconPng: "x".repeat(10) },
      { id: "2", url: "https://b.com/", iconPng: "x".repeat(ICON_MAX_BASE64_LENGTH + 1) },
      { id: 3, url: "https://c.com/" },
      null,
    ];
    const b = sanitizeBookmarks(raw);
    expect(b).toHaveLength(2);
    expect(b[0].iconPng).toHaveLength(10);
    expect(b[1].iconPng).toBeNull();
    expect(b[1].title).toBe("https://b.com/");
  });
});

describe("bookmarks", () => {
  it("upserts by url instead of duplicating", () => {
    let list = upsertBookmark([], { url: "https://a.com/", title: "A", iconPng: null });
    list = upsertBookmark(list, { url: "https://a.com/", title: "A2", iconPng: "icon" });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("A2");
    expect(list[0].iconPng).toBe("icon");
  });

  it("keeps the old icon when the refresh has none", () => {
    let list = upsertBookmark([], { url: "https://a.com/", title: "A", iconPng: "icon" });
    list = upsertBookmark(list, { url: "https://a.com/", title: "A", iconPng: null });
    expect(list[0].iconPng).toBe("icon");
  });

  it("falls back to the host as title and redacts the url", () => {
    const list = upsertBookmark([], {
      url: "https://www.a.com/cb?code=secret",
      title: "  ",
      iconPng: null,
    });
    expect(list[0].title).toBe("a.com");
    expect(list[0].url).toContain("code=redacted");
  });

  it("removes by id", () => {
    const list = upsertBookmark([], { url: "https://a.com/", title: "A", iconPng: null });
    expect(removeBookmark(list, list[0].id)).toHaveLength(0);
    expect(removeBookmark(list, "missing")).toHaveLength(1);
  });
});

describe("tileFor", () => {
  it("is deterministic per host", () => {
    expect(tileFor("https://www.github.com/x")).toEqual(tileFor("https://github.com/y"));
    expect(tileFor("https://github.com/").letter).toBe("G");
  });
});

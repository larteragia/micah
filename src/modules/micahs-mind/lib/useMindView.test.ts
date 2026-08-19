/**
 * Pure decisions of the mind view machine (card mindwalk-real, E4):
 * uuid validation before any URL is built (plan decision 3), the exact
 * deep-link the webview navigates to, and the phase truth table that
 * drives what the panel shows.
 */

import { describe, expect, it } from "vitest";
import {
  deriveMindPhase,
  type MindStatus,
  mindUrl,
  normalizeMindSession,
} from "./useMindView";

const UUID = "3f2a1b0c-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("normalizeMindSession (decisão 3: só uuid navega)", () => {
  it("accepts a lowercase uuid as-is", () => {
    expect(normalizeMindSession(UUID)).toBe(UUID);
  });
  it("lowercases before validating, so an uppercase uuid still connects", () => {
    expect(normalizeMindSession(UUID.toUpperCase())).toBe(UUID);
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeMindSession(`  ${UUID}\n`)).toBe(UUID);
  });
  it("rejects null, undefined and empty", () => {
    expect(normalizeMindSession(null)).toBeNull();
    expect(normalizeMindSession(undefined)).toBeNull();
    expect(normalizeMindSession("")).toBeNull();
  });
  it("rejects anything that is not exactly a uuid", () => {
    // resume labels, paths, and near-uuids must become "absent", never a URL
    expect(normalizeMindSession("latest")).toBeNull();
    expect(normalizeMindSession("C:/Users/x/sessao.jsonl")).toBeNull();
    expect(normalizeMindSession(`${UUID}x`)).toBeNull();
    expect(normalizeMindSession(UUID.slice(1))).toBeNull();
    expect(normalizeMindSession(UUID.replace(/-/g, ""))).toBeNull();
    expect(
      normalizeMindSession("gggggggg-4d5e-6f70-8192-a3b4c5d6e7f8"),
    ).toBeNull();
    // an embedded uuid is not a uuid (query-injection shape)
    expect(normalizeMindSession(`${UUID}&follow=0`)).toBeNull();
  });
});

describe("mindUrl", () => {
  it("builds the loopback deep-link with the fork's follow mode on", () => {
    expect(mindUrl(4517, UUID)).toBe(
      `http://127.0.0.1:4517/?session=${UUID}&follow=1`,
    );
  });
});

describe("deriveMindPhase (máquina de estados do painel)", () => {
  const ready: MindStatus = { state: "ready", port: 4517, restarts: 0 };

  it("gate off is off, whatever the sidecar is doing", () => {
    expect(
      deriveMindPhase({
        enabled: false,
        status: ready,
        session: UUID,
        sessionReady: true,
      }),
    ).toBe("off");
  });

  it("no status yet, or an off/starting sidecar, is sidecar-starting", () => {
    for (const status of [
      null,
      { state: "off", restarts: 0 } satisfies MindStatus,
      { state: "starting", restarts: 1 } satisfies MindStatus,
    ]) {
      expect(
        deriveMindPhase({
          enabled: true,
          status,
          session: UUID,
          sessionReady: false,
        }),
      ).toBe("sidecar-starting");
    }
  });

  it("a dead sidecar is dead even with a valid session in hand", () => {
    expect(
      deriveMindPhase({
        enabled: true,
        status: { state: "dead", restarts: 5, lastError: "spawn falhou" },
        session: UUID,
        sessionReady: true,
      }),
    ).toBe("dead");
  });

  it("ready without a port is not usable yet: still starting", () => {
    expect(
      deriveMindPhase({
        enabled: true,
        status: { state: "ready", restarts: 0 },
        session: UUID,
        sessionReady: false,
      }),
    ).toBe("sidecar-starting");
  });

  it("ready sidecar with no valid session is session-absent", () => {
    expect(
      deriveMindPhase({
        enabled: true,
        status: ready,
        session: null,
        sessionReady: false,
      }),
    ).toBe("session-absent");
  });

  it("session picked but handshake pending is session-waiting", () => {
    expect(
      deriveMindPhase({
        enabled: true,
        status: ready,
        session: UUID,
        sessionReady: false,
      }),
    ).toBe("session-waiting");
  });

  it("handshake confirmed is ready — the webview is the screen", () => {
    expect(
      deriveMindPhase({
        enabled: true,
        status: ready,
        session: UUID,
        sessionReady: true,
      }),
    ).toBe("ready");
  });

  it("a session switch drops sessionReady and goes back to waiting", () => {
    // the hook resets sessionReady when pick.session changes; the phase
    // must follow it back without a detach (plan decision 4)
    const before = deriveMindPhase({
      enabled: true,
      status: ready,
      session: UUID,
      sessionReady: true,
    });
    const after = deriveMindPhase({
      enabled: true,
      status: ready,
      session: "00000000-0000-4000-8000-000000000000",
      sessionReady: false,
    });
    expect(before).toBe("ready");
    expect(after).toBe("session-waiting");
  });
});

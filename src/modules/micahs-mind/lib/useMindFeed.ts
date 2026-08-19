/**
 * Session selection for Micah's Mind: which Claude session the panel
 * follows, and how a vanished transcript is labeled. The live feed that
 * used to live here (tail + fold + homemade citymap) died with the card
 * mindwalk-real-no-micahs-mind-2026-08-19 — the real mindwalk sidecar owns
 * parsing and rendering now; these pure pickers are the surviving plumbing
 * the webview driver (useMindView) is pointed by.
 */

export type MindSessionPick = {
  session: string | null;
  why:
    | "focused-leaf"
    | "single-anchored"
    | "ambiguous"
    | "none"
    | "manual"
    | "auto-recent";
};

/**
 * Auditor correction 10: the focused pane of the active tab decides; with no
 * resolvable focus, exactly one anchored visible pane still wins; two or
 * more is ambiguous and shows the empty state instead of guessing.
 */
export function pickMindSession(args: {
  activeLeafId?: number | null;
  resolveLeafResume?: (leafId: number) => string | null;
  anchoredLeaves?: { leafId: number; resume: string }[];
  visibleLeafIds?: number[];
}): MindSessionPick {
  const { activeLeafId, resolveLeafResume, anchoredLeaves, visibleLeafIds } =
    args;
  if (activeLeafId != null && resolveLeafResume) {
    const resume = resolveLeafResume(activeLeafId);
    if (resume) return { session: resume, why: "focused-leaf" };
  }
  const inScope = (leafId: number) =>
    visibleLeafIds === undefined || visibleLeafIds.includes(leafId);
  const anchored = (anchoredLeaves ?? [])
    .filter((a) => inScope(a.leafId) && a.resume)
    .sort((a, b) => a.leafId - b.leafId);
  if (anchored.length === 1)
    return { session: anchored[0].resume, why: "single-anchored" };
  if (anchored.length > 1) return { session: null, why: "ambiguous" };
  return { session: null, why: "none" };
}

/**
 * Fixed priority for what the scene follows (card sempre-visivel): a real
 * anchor beats a manual picker choice, a manual choice beats the
 * auto-connect. An ambiguous verdict (two anchored panes, no focus) no
 * longer blocks the auto-connect: with the selector and the replay badge
 * on screen, following the freshest session of the location is labeled
 * provenance, not guessing — and the user can pick another in one click.
 */
export function composePick(
  anchored: MindSessionPick,
  manualSession: string | null,
  auto: { session: string | null; forCwd: string } | null,
): MindSessionPick {
  if (anchored.session) return anchored;
  if (manualSession) return { session: manualSession, why: "manual" };
  if (auto?.session) return { session: auto.session, why: "auto-recent" };
  return anchored;
}

/**
 * Transcript not found mid-feed: a session that ALREADY synced keeps its
 * city and fold on screen as "missing" (the transcript went away — badge
 * tells the truth, map stays); a session never seen is just "absent".
 */
export function absentStatus(synced: boolean): "missing" | "absent" {
  return synced ? "missing" : "absent";
}

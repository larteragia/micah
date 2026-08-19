/**
 * Pane-anchored mind identity (card p4p6, P4 of the commander's plan): the
 * map's identity is the PANE the user is looking at, not a third-party
 * transcript file. Sessions attach and detach underneath (anchor changes,
 * resume forks, transcript vanishes) while the pane keeps its history and
 * its frozen city. In-memory only for this card; durable WAL/run records
 * are E7 material (merge doc), not here.
 */

type PaneMindRecord = {
  /** Every session this pane has followed, in attachment order, deduped. */
  sessions: string[];
  /** Session the pane is currently following, when any. */
  current: string | null;
  /** Snapshot kept when the transcript vanished: the city stays on screen. */
  frozen: { sessionId: string; files: number; events: number } | null;
};

const records = new Map<number, PaneMindRecord>();

function recordFor(paneId: number): PaneMindRecord {
  let rec = records.get(paneId);
  if (!rec) {
    rec = { sessions: [], current: null, frozen: null };
    records.set(paneId, rec);
  }
  return rec;
}

/** The pane starts following a session (anchor, manual pick or auto). */
export function attachPaneSession(paneId: number, sessionId: string): void {
  const rec = recordFor(paneId);
  if (rec.current === sessionId) return;
  rec.current = sessionId;
  rec.frozen = null;
  if (!rec.sessions.includes(sessionId)) rec.sessions.push(sessionId);
}

/** The transcript under the pane went missing: freeze what the city held. */
export function freezePaneCity(
  paneId: number,
  sessionId: string,
  files: number,
  events: number,
): void {
  const rec = recordFor(paneId);
  rec.frozen = { sessionId, files, events };
}

/** Full history of sessions this pane has shown (the pane's identity). */
export function paneSessionHistory(paneId: number): string[] {
  return [...(records.get(paneId)?.sessions ?? [])];
}

export function paneCurrentSession(paneId: number): string | null {
  return records.get(paneId)?.current ?? null;
}

export function paneFrozenSnapshot(paneId: number): PaneMindRecord["frozen"] {
  return records.get(paneId)?.frozen ?? null;
}

/** Tests only: drop all state. */
export function resetPaneAnchors(): void {
  records.clear();
}

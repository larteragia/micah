import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

/**
 * A CodeMirror surface that only ever appends. CM6 over xterm+WebGL on
 * purpose: the renderer pool rations WebGL contexts at 5 and a viewer lane
 * must never evict a live terminal's renderer; CM virtualizes the viewport
 * and is already in the bundle. Read-only twice over (readOnly facet AND
 * editable(false)): typing here must alter nothing.
 *
 * Appends are batched per animation frame; the store caps content upstream,
 * and when its head-trim rewrites the prefix the doc is replaced in a single
 * transaction instead of appended.
 */
export function ReadOnlyStream({ content }: { content: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownRef = useRef("");
  const pendingRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "100%", fontSize: "11px" },
            ".cm-scroller": {
              fontFamily:
                "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
              lineHeight: "1.5",
            },
            ".cm-content": { padding: "6px 0" },
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    shownRef.current = "";
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    pendingRef.current = content;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const view = viewRef.current;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (!view || next === null || next === shownRef.current) return;
      const prev = shownRef.current;
      shownRef.current = next;
      if (next.startsWith(prev)) {
        view.dispatch({
          changes: { from: view.state.doc.length, insert: next.slice(prev.length) },
          effects: EditorView.scrollIntoView(next.length),
        });
      } else {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          effects: EditorView.scrollIntoView(next.length),
        });
      }
    });
  }, [content]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}

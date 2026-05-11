import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { RGBA, SyntaxStyle, type TreeSitterClient } from "@opentui/core";
import { createFinder, type Hit } from "./finder.ts";
import { getHighlighter } from "./highlighter.ts";
import { buildAbsPath, loadPreview, sliceAround, type PreviewContent } from "./preview.ts";
import { pasteToPane, resolveAgentPane } from "./tmux.ts";

type Mode = "files" | "content";

type PickerProps = {
  readonly cwd: string;
  readonly targetPane: string | null;
  readonly initialQuery?: string;
};

const DIM_FG = "#665c54";
const PROMPT_FG = "#fabd2f";
const ITEM_FG = "#a89984";
const SELECTED_FG = "#ebdbb2";
const SELECTED_BG = "#3c3836";
const PATH_FG = "#7c6f64";
const ACCENT = "#83a598";
const PANEL_BG = "#1d2021";

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#fb4934"), bold: true },
  string: { fg: RGBA.fromHex("#b8bb26") },
  comment: { fg: RGBA.fromHex("#665c54"), italic: true },
  number: { fg: RGBA.fromHex("#d3869b") },
  function: { fg: RGBA.fromHex("#8ec07c") },
  type: { fg: RGBA.fromHex("#fabd2f") },
  property: { fg: RGBA.fromHex("#83a598") },
  default: { fg: RGBA.fromHex("#ebdbb2") },
});

export function PickerApp({ cwd, targetPane, initialQuery = "" }: PickerProps) {
  const renderer = useRenderer();
  const finderRef = useRef(createFinder(cwd));
  const [mode, setMode] = useState<Mode>("files");
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<{ content: PreviewContent; startLine: number } | null>(
    null,
  );
  const [highlighter, setHighlighter] = useState<TreeSitterClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter().then((client) => {
      if (!cancelled) setHighlighter(client);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => finderRef.current.destroy();
  }, []);

  useEffect(() => {
    const finder = finderRef.current;
    let cancelled = false;
    setSearching(true);
    const run = async () => {
      const results =
        mode === "files"
          ? await finder.searchFiles(query, 100)
          : await finder.searchContent(query, 100);
      if (cancelled) return;
      setHits(results);
      setSelected(0);
      setSearching(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, mode]);

  useEffect(() => {
    let cancelled = false;
    const hit = hits[selected];
    if (!hit) {
      setPreview(null);
      return;
    }
    const load = async () => {
      const abs = buildAbsPath(cwd, hit.path);
      const content = await loadPreview(abs);
      if (cancelled || !content) {
        if (!cancelled) setPreview(null);
        return;
      }
      const lineNumber = hit.kind === "content" ? hit.lineNumber : 0;
      const slice = lineNumber > 0 ? sliceAround(content.text, lineNumber, 30) : { text: content.text, startLine: 1 };
      setPreview({ content: { ...content, text: slice.text }, startLine: slice.startLine });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [hits, selected, cwd]);

  const exit = (code = 0) => {
    finderRef.current.destroy();
    renderer.destroy();
    process.exit(code);
  };

  const accept = async (hit: Hit) => {
    const insertion = formatInsertion(hit);
    if (targetPane) {
      const real = await resolveAgentPane(targetPane);
      await pasteToPane(real, insertion);
    } else {
      process.stdout.write(insertion);
    }
    exit(0);
  };

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      exit(0);
      return;
    }
    if (key.name === "tab") {
      setMode((m) => (m === "files" ? "content" : "files"));
      return;
    }
    if (key.name === "return") {
      const hit = hits[selected];
      if (hit) void accept(hit);
      return;
    }
    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setSelected((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setSelected((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    if (key.sequence && key.sequence.length === 1) {
      const ch = key.sequence;
      if (ch >= " " && ch.charCodeAt(0) < 127) {
        setQuery((q) => q + ch);
      }
    }
  });

  const visible = useMemo(() => hits.slice(0, 200), [hits]);
  const visibleSelected = Math.min(selected, Math.max(visible.length - 1, 0));

  return (
    <box style={{ flexDirection: "column", padding: 1, flexGrow: 1 }}>
      <Prompt mode={mode} query={query} searching={searching} hitCount={hits.length} />
      <box style={{ flexDirection: "row", marginTop: 1, flexGrow: 1, gap: 1 }}>
        <box style={{ flexDirection: "column", width: "45%", flexShrink: 0 }}>
          {visible.length === 0 ? (
            <text fg={DIM_FG}>{searching ? "searching…" : "no matches"}</text>
          ) : (
            visible
              .slice(Math.max(0, visibleSelected - 10), Math.max(0, visibleSelected - 10) + 30)
              .map((hit, i) => {
                const actualIndex = i + Math.max(0, visibleSelected - 10);
                return (
                  <Row
                    key={rowKey(hit, actualIndex)}
                    hit={hit}
                    selected={actualIndex === visibleSelected}
                  />
                );
              })
          )}
        </box>
        <Preview preview={preview} highlighter={highlighter} />
      </box>
      <text fg={DIM_FG}>↵ insert · ⇥ {mode === "files" ? "→ content" : "→ files"} · esc cancel</text>
    </box>
  );
}

function Prompt({
  mode,
  query,
  searching,
  hitCount,
}: {
  readonly mode: Mode;
  readonly query: string;
  readonly searching: boolean;
  readonly hitCount: number;
}) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={ACCENT}>{mode === "files" ? "files" : "grep "} </text>
      <text fg={PROMPT_FG}>❯ </text>
      <text fg={SELECTED_FG}>{query}</text>
      <text fg={DIM_FG}>▏</text>
      <text fg={DIM_FG}>  {searching ? "…" : `${hitCount}`}</text>
    </box>
  );
}

function Row({ hit, selected }: { readonly hit: Hit; readonly selected: boolean }) {
  const pointer = selected ? "▍" : " ";
  const pointerColor = selected ? ACCENT : "#3c3836";
  const bg = selected ? SELECTED_BG : undefined;
  const nameColor = selected ? SELECTED_FG : ITEM_FG;

  if (hit.kind === "file") {
    const dir = hit.path.slice(0, hit.path.length - hit.fileName.length);
    return (
      <box
        style={{
          flexDirection: "row",
          paddingLeft: 1,
          paddingRight: 1,
          width: "100%",
          backgroundColor: bg,
        }}
      >
        <text fg={pointerColor}>{pointer} </text>
        <text fg={PATH_FG}>{dir}</text>
        <text fg={nameColor}>{hit.fileName}</text>
      </box>
    );
  }

  return (
    <box
      style={{
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
        backgroundColor: bg,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text fg={pointerColor}>{pointer} </text>
        <text fg={nameColor}>{hit.fileName}</text>
        <text fg={DIM_FG}>:{hit.lineNumber}</text>
      </box>
      <box style={{ flexDirection: "row", paddingLeft: 4 }}>
        <text fg={DIM_FG}>{hit.line.slice(0, 200)}</text>
      </box>
    </box>
  );
}

function Preview({
  preview,
  highlighter,
}: {
  readonly preview: { content: PreviewContent; startLine: number } | null;
  readonly highlighter: TreeSitterClient | null;
}) {
  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: PANEL_BG,
      }}
    >
      {preview ? (
        preview.content.filetype && highlighter ? (
          <code
            content={preview.content.text}
            filetype={preview.content.filetype}
            syntaxStyle={syntaxStyle}
            treeSitterClient={highlighter}
          />
        ) : (
          <text fg={ITEM_FG}>{preview.content.text}</text>
        )
      ) : (
        <text fg={DIM_FG}>no preview</text>
      )}
    </box>
  );
}

function rowKey(hit: Hit, index: number): string {
  if (hit.kind === "content") return `${hit.path}:${hit.lineNumber}:${index}`;
  return `${hit.path}:${index}`;
}

function formatInsertion(hit: Hit): string {
  if (hit.kind === "content") return `@${hit.path}:${hit.lineNumber} `;
  return `@${hit.path} `;
}

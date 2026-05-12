import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { type ColorInput, type ScrollBoxRenderable, type TreeSitterClient } from "@opentui/core";
import { createFinder, type Hit } from "./finder.ts";
import { getHighlighter } from "./highlighter.ts";
import { buildAbsPath, loadPreview, sliceAround, type PreviewContent } from "./preview.ts";
import type { NvimContextSource } from "../shared/nvim-context.ts";
import type { PickerTheme } from "./theme.ts";
import { pasteToPane, resolveAgentPane } from "./tmux.ts";

type Mode = "files" | "content";

type PickerProps = {
  readonly cwd: string;
  readonly targetPane: string | null;
  readonly initialQuery?: string;
  readonly theme: PickerTheme;
};

export function PickerApp({ cwd, targetPane, initialQuery = "", theme }: PickerProps) {
  const renderer = useRenderer();
  const finderRef = useRef(createFinder(cwd));
  const resultsRef = useRef<ScrollBoxRenderable | null>(null);
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
      const slice =
        lineNumber > 0 ? sliceAround(content.text, lineNumber, 30) : { text: content.text, startLine: 1 };
      setPreview({
        content: { ...content, text: slice.text, isPartial: content.isPartial || lineNumber > 0 },
        startLine: slice.startLine,
      });
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

  useEffect(() => {
    resultsRef.current?.scrollChildIntoView(resultRowId(visibleSelected));
  }, [visibleSelected, visible]);

  return (
    <box style={{ flexDirection: "column", padding: 1, flexGrow: 1 }}>
      <Prompt mode={mode} query={query} searching={searching} hitCount={hits.length} theme={theme} />
      <box style={{ flexDirection: "row", marginTop: 1, flexGrow: 1, gap: 1 }}>
        <scrollbox
          ref={resultsRef}
          scrollY={true}
          scrollX={false}
          viewportCulling={true}
          style={{ flexDirection: "column", width: "45%", flexShrink: 0 }}
        >
          {visible.length === 0 ? (
            <text fg={theme.colors.dimFg}>{searching ? "searching…" : "no matches"}</text>
          ) : (
            visible.map((hit, index) => (
              <Row
                key={rowKey(hit, index)}
                id={resultRowId(index)}
                hit={hit}
                query={query}
                selected={index === visibleSelected}
                theme={theme}
              />
            ))
          )}
        </scrollbox>
        <Preview preview={preview} highlighter={highlighter} theme={theme} />
      </box>
      <text fg={theme.colors.dimFg}>↵ insert · ⇥ {mode === "files" ? "→ content" : "→ files"} · esc cancel</text>
    </box>
  );
}

function Prompt({
  mode,
  query,
  searching,
  hitCount,
  theme,
}: {
  readonly mode: Mode;
  readonly query: string;
  readonly searching: boolean;
  readonly hitCount: number;
  readonly theme: PickerTheme;
}) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={theme.colors.accent}>{mode === "files" ? "files" : "grep "} </text>
      <text fg={theme.colors.promptFg}>❯ </text>
      <text fg={theme.colors.selectedFg}>{query}</text>
      <text fg={theme.colors.dimFg}>▏</text>
      <text fg={theme.colors.dimFg}>  {searching ? "…" : `${hitCount}`}</text>
    </box>
  );
}

function Row({
  id,
  hit,
  query,
  selected,
  theme,
}: {
  readonly id: string;
  readonly hit: Hit;
  readonly query: string;
  readonly selected: boolean;
  readonly theme: PickerTheme;
}) {
  const pointer = selected ? "▍" : " ";
  const pointerColor = selected ? theme.colors.accent : theme.colors.selectedBg;
  const bg = selected ? theme.colors.selectedBg : undefined;
  const nameColor = selected ? theme.colors.selectedFg : theme.colors.itemFg;

  if (hit.kind === "file") {
    const dir = hit.path.slice(0, hit.path.length - hit.fileName.length);
    const badge = nvimBadge(hit.source);
    return (
      <box
        id={id}
        style={{
          flexDirection: "row",
          paddingLeft: 1,
          paddingRight: 1,
          width: "100%",
          backgroundColor: bg,
        }}
      >
        <text fg={pointerColor}>{pointer} </text>
        {badge ? <Badge label={badge} theme={theme} selected={selected} /> : null}
        <HighlightedText
          text={dir}
          query={query}
          fg={theme.colors.pathFg}
          matchFg={theme.colors.accent}
        />
        <HighlightedText
          text={hit.fileName}
          query={query}
          fg={nameColor}
          matchFg={theme.colors.accent}
        />
      </box>
    );
  }

  return (
    <box
      id={id}
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
        <HighlightedText
          text={hit.fileName}
          query={query}
          fg={nameColor}
          matchFg={theme.colors.accent}
        />
        <text fg={theme.colors.dimFg}>:{hit.lineNumber}</text>
      </box>
      <box style={{ flexDirection: "row", paddingLeft: 4 }}>
        <HighlightedText
          text={hit.line.slice(0, 200)}
          query={query}
          fg={theme.colors.dimFg}
          matchFg={theme.colors.accent}
        />
      </box>
    </box>
  );
}

function Preview({
  preview,
  highlighter,
  theme,
}: {
  readonly preview: { content: PreviewContent; startLine: number } | null;
  readonly highlighter: TreeSitterClient | null;
  readonly theme: PickerTheme;
}) {
  const shouldRenderMarkdown =
    preview?.content.filetype === "markdown" && !preview.content.isPartial;

  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: theme.colors.panelBg,
      }}
    >
      {preview ? (
        shouldRenderMarkdown ? (
          <markdown
            content={preview.content.text}
            syntaxStyle={theme.syntaxStyle}
            treeSitterClient={highlighter ?? undefined}
          />
        ) : preview.content.filetype && highlighter ? (
          <code
            content={preview.content.text}
            filetype={preview.content.filetype}
            syntaxStyle={theme.syntaxStyle}
            treeSitterClient={highlighter}
          />
        ) : (
          <text fg={theme.colors.itemFg}>{preview.content.text}</text>
        )
      ) : (
        <text fg={theme.colors.dimFg}>no preview</text>
      )}
    </box>
  );
}

function Badge({
  label,
  selected,
  theme,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly theme: PickerTheme;
}) {
  return (
    <>
      <text fg={selected ? theme.colors.selectedBg : theme.colors.panelBg} bg={theme.colors.accent}>{` ${label} `}</text>
      <text fg={theme.colors.dimFg}> </text>
    </>
  );
}

function HighlightedText({
  fg,
  matchFg,
  query,
  text,
}: {
  readonly fg: ColorInput;
  readonly matchFg: ColorInput;
  readonly query: string;
  readonly text: string;
}) {
  const parts = splitMatches(text, query);
  return (
    <>
      {parts.map((part, index) => (
        <text key={`${index}:${part.text}`} fg={part.match ? matchFg : fg}>{part.text}</text>
      ))}
    </>
  );
}

function splitMatches(text: string, query: string): readonly { readonly text: string; readonly match: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];

  const parts: { text: string; match: boolean }[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), match: false });
    }
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}

function nvimBadge(source: NvimContextSource | null): string | null {
  if (!source) return null;
  return "NV";
}

function rowKey(hit: Hit, index: number): string {
  if (hit.kind === "content") return `${hit.path}:${hit.lineNumber}:${index}`;
  return `${hit.path}:${index}`;
}

function resultRowId(index: number): string {
  return `picker-result-${index}`;
}

function formatInsertion(hit: Hit): string {
  if (hit.kind === "content") return `@${hit.path}:${hit.lineNumber} `;
  return `@${hit.path} `;
}

// The "Hlavičky" grid, on its own so two very different hosts can share it: the
// board's Headers panel (every game in the open file) and the competition-leader
// mode (only the games under the selected round/match/game). Both want the same
// Standardní / Plný / Zápasový views, the same inline bulk editing written back to
// disk, and the same ECO/PlyCount recompute — the only real difference is *which*
// games are on screen.
//
// So the grid never decides that itself. `games` is always the whole file, index
// -aligned with it, and `rows` says which of those indices to show and in what
// order. Every index the grid hands out — onOpen, onWritten, the edit map — is an
// index into the file, so a scoped grid writes to exactly the same places an
// unscoped one would and a host never has to translate.

import {
  Button,
  Group,
  Menu,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getEcoFromGame } from "@/utils/chess";
import { setGameTag } from "@/utils/pgn/check";
import { getTag, splitGame } from "@/utils/pgn/tags";

type ViewMode = "standard" | "full" | "match";

type SplitGame = ReturnType<typeof splitGame>;

/** One displayed row: the parsed game and its index in the file. */
type Row = { index: number; g: SplitGame };

// h = PGN tag name (or the derived pseudo-column "PlyCount"); labelKey/tipKey are
// i18n keys; tone/sq drive the white/black square shown in the header.
type ColDef = {
  h: string;
  labelKey: string;
  w?: number;
  tone?: "white" | "black";
  sq?: boolean;
  center?: boolean;
};

const STANDARD_COLS: ColDef[] = [
  { h: "White", labelKey: "Headers.Col.White", w: 150, tone: "white" },
  { h: "WhiteElo", labelKey: "Headers.Col.Elo", w: 55, tone: "white", sq: true },
  { h: "Black", labelKey: "Headers.Col.Black", w: 150, tone: "black" },
  { h: "BlackElo", labelKey: "Headers.Col.Elo", w: 55, tone: "black", sq: true },
  { h: "Result", labelKey: "Headers.Col.Result", w: 70, center: true },
  { h: "Date", labelKey: "Headers.Col.Date", w: 95 },
  { h: "Event", labelKey: "Headers.Col.Event", w: 170 },
  { h: "Round", labelKey: "Headers.Col.Round", w: 55 },
  { h: "ECO", labelKey: "Headers.Col.ECO", w: 45 },
  { h: "PlyCount", labelKey: "Headers.Col.PlyCount", w: 60, center: true },
  { h: "Site", labelKey: "Headers.Col.Site", w: 110 },
  { h: "WhiteTeam", labelKey: "Headers.Col.Team", w: 130, tone: "white", sq: true },
  { h: "BlackTeam", labelKey: "Headers.Col.Team", w: 130, tone: "black", sq: true },
];

const FULL_COLS: ColDef[] = [
  { h: "White", labelKey: "Headers.Col.White", w: 140, tone: "white" },
  { h: "WhiteElo", labelKey: "Headers.Col.Elo", w: 50, tone: "white", sq: true },
  { h: "Black", labelKey: "Headers.Col.Black", w: 140, tone: "black" },
  { h: "BlackElo", labelKey: "Headers.Col.Elo", w: 50, tone: "black", sq: true },
  { h: "Result", labelKey: "Headers.Col.Result", w: 60, center: true },
  { h: "Date", labelKey: "Headers.Col.Date", w: 90 },
  { h: "Round", labelKey: "Headers.Col.Round", w: 50 },
  { h: "Board", labelKey: "Headers.Col.Board", w: 45 },
  { h: "Event", labelKey: "Headers.Col.Event", w: 150 },
  { h: "Site", labelKey: "Headers.Col.Site", w: 90 },
  { h: "WhiteTeam", labelKey: "Headers.Col.Team", w: 120, tone: "white", sq: true },
  { h: "BlackTeam", labelKey: "Headers.Col.Team", w: 120, tone: "black", sq: true },
  { h: "ECO", labelKey: "Headers.Col.ECO", w: 40 },
  { h: "WhiteFideElo", labelKey: "Headers.Col.FideElo", w: 55, tone: "white", sq: true },
  { h: "BlackFideElo", labelKey: "Headers.Col.FideElo", w: 55, tone: "black", sq: true },
  { h: "WhiteCzeElo", labelKey: "Headers.Col.CzeElo", w: 55, tone: "white", sq: true },
  { h: "BlackCzeElo", labelKey: "Headers.Col.CzeElo", w: 55, tone: "black", sq: true },
  { h: "WhiteFideId", labelKey: "Headers.Col.FideId", w: 70, tone: "white", sq: true },
  { h: "BlackFideId", labelKey: "Headers.Col.FideId", w: 70, tone: "black", sq: true },
  { h: "WhiteCzeId", labelKey: "Headers.Col.CzeId", w: 70, tone: "white", sq: true },
  { h: "BlackCzeId", labelKey: "Headers.Col.CzeId", w: 70, tone: "black", sq: true },
];

// Half-move count derived from the movetext: strip comments, nested variations,
// NAGs, move numbers and the result token, then count the remaining SAN tokens.
function countPlies(movetext: string): number {
  let s = movetext.replace(/\{[^}]*\}/g, " ").replace(/\$\d+/g, " ");
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, " ");
  } while (s !== prev);
  s = s.replace(/\d+\.(\.\.)?/g, " ").replace(/(1-0|0-1|1\/2-1\/2|\*)/g, " ");
  return s.split(/\s+/).filter(Boolean).length;
}

function ColSquare({ white }: { white: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        background: white ? "#fff" : "#000",
        border: "1px solid var(--mantine-color-dimmed)",
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
  );
}

function boardResult(result: string, homeIsWhite: boolean): { text: string; color?: string } {
  if (!result || result === "*") return { text: "*", color: "dimmed" };
  if (result === "1/2-1/2") return { text: "½:½", color: "dimmed" };
  const whiteWon = result === "1-0";
  const blackWon = result === "0-1";
  if (!whiteWon && !blackWon) return { text: result, color: "dimmed" };
  const homeWon = homeIsWhite ? whiteWon : blackWon;
  return homeWon ? { text: "1:0", color: "teal" } : { text: "0:1", color: "red" };
}

function resultColor(result: string): string | undefined {
  if (result === "1-0") return "teal";
  if (result === "0-1") return "red";
  return undefined;
}

export function HeadersGrid({
  path,
  games,
  rows,
  activeIndex,
  onOpen,
  onReload,
  onWritten,
  matchView = false,
  canRecomputeActive = false,
  viewModeKey = "headers-view-mode",
  toolbar,
  loading = false,
}: {
  /** File the games live in — edits are written back to it whole. */
  path: string | undefined;
  /** Every game in the file, index-aligned with it. */
  games: string[];
  /** Which games to display, as indices into `games`, in display order. */
  rows: number[];
  /** Index of the game open on a board, highlighted. */
  activeIndex?: number;
  /** Row clicked. Receives the index in the file. */
  onOpen?: (index: number) => void;
  /** Re-read `games` from disk — the grid calls this after every write. */
  onReload: () => void | Promise<void>;
  /** After a successful write: the new file contents and the indices that changed. */
  onWritten?: (games: string[], touched: number[]) => void | Promise<void>;
  /** Offer the Zápasový view, which only makes sense for a single match. */
  matchView?: boolean;
  /** Offer "recompute only the open game". */
  canRecomputeActive?: boolean;
  /** Where the chosen view is remembered. */
  viewModeKey?: string;
  /** Extra buttons, rendered after the built-in ones. */
  toolbar?: React.ReactNode;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem(viewModeKey);
    return s === "full" || s === "match" ? s : "standard";
  });
  useEffect(() => {
    localStorage.setItem(viewModeKey, viewMode);
  }, [viewMode, viewModeKey]);
  useEffect(() => {
    if (!matchView && viewMode === "match") setViewMode("standard");
  }, [matchView, viewMode]);

  // Inline bulk editing: edits[fileIndex][tag] = new value (diffs only).
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const dirtyCount = Object.keys(edits).length;
  // "Upravit" from the match view opens the standard table; leaving edit returns.
  const returnToMatchRef = useRef(false);

  const shown: Row[] = useMemo(
    () =>
      rows.filter((i) => games[i] !== undefined).map((i) => ({ index: i, g: splitGame(games[i]) })),
    [games, rows],
  );

  function setCell(index: number, tag: string, value: string, orig: string) {
    setEdits((prev) => {
      const forGame = { ...(prev[index] ?? {}) };
      if (value === orig) delete forGame[tag];
      else forGame[tag] = value;
      const next = { ...prev };
      if (Object.keys(forGame).length === 0) delete next[index];
      else next[index] = forGame;
      return next;
    });
  }

  function enterEditMode() {
    if (viewMode === "match") {
      returnToMatchRef.current = true;
      setViewMode("standard");
    } else {
      returnToMatchRef.current = false;
    }
    setEditMode(true);
  }

  function leaveEditMode() {
    setEditMode(false);
    if (returnToMatchRef.current) {
      returnToMatchRef.current = false;
      setViewMode("match");
    }
  }

  async function cancelEdit() {
    if (dirtyCount > 0 && !(await confirmDialog(t("Headers.DiscardConfirm", { n: dirtyCount })))) {
      return;
    }
    setEdits({});
    leaveEditMode();
  }

  async function saveEdits() {
    if (!path || dirtyCount === 0) {
      leaveEditMode();
      return;
    }
    setBusy(true);
    try {
      const next = games.slice();
      const touched: number[] = [];
      for (const [idxStr, cellEdits] of Object.entries(edits)) {
        const idx = Number(idxStr);
        let g = next[idx];
        if (g === undefined) continue;
        for (const [tag, value] of Object.entries(cellEdits)) g = setGameTag(g, tag, value);
        next[idx] = g;
        touched.push(idx);
      }
      await writeTextFile(path, next.join("\n\n\n") + "\n");
      const saved = dirtyCount;
      setEdits({});
      leaveEditMode();
      await onWritten?.(next, touched);
      await onReload();
      notifications.show({
        title: t("Board.Tabs.Headers"),
        message: t("Headers.Saved", { n: saved }),
        color: "teal",
      });
    } catch (e) {
      notifications.show({ title: t("Board.Tabs.Headers"), message: String(e), color: "red" });
    } finally {
      setBusy(false);
    }
  }

  // Recompute the derived ECO and PlyCount tags and write them back to disk.
  // scope: "all" every displayed game · "empty" only where the tag is missing/blank ·
  // "selected" only the currently open game. ECO is only written when a book
  // position actually matches, so we never clobber a value we can't recompute.
  async function recompute(scope: "all" | "empty" | "selected") {
    if (!path || shown.length === 0) return;
    setBusy(true);
    try {
      const next = games.slice();
      const indices =
        scope === "selected"
          ? activeIndex !== undefined && next[activeIndex] !== undefined
            ? [activeIndex]
            : []
          : shown.map((r) => r.index);

      const touched: number[] = [];
      for (const idx of indices) {
        const { tags, movetext } = splitGame(next[idx]);
        const curEco = getTag(tags, "ECO") ?? "";
        const curPly = getTag(tags, "PlyCount") ?? "";
        let g = next[idx];
        let changed = false;

        if (scope !== "empty" || curPly === "") {
          const ply = String(countPlies(movetext));
          if (ply !== curPly) {
            g = setGameTag(g, "PlyCount", ply);
            changed = true;
          }
        }
        if (scope !== "empty" || curEco === "") {
          const eco = await getEcoFromGame(next[idx]);
          if (eco && eco !== curEco) {
            g = setGameTag(g, "ECO", eco);
            changed = true;
          }
        }
        if (changed) {
          next[idx] = g;
          touched.push(idx);
        }
      }

      if (touched.length === 0) {
        notifications.show({
          title: t("Board.Tabs.Headers"),
          message: t("Headers.Recompute.None"),
        });
        return;
      }

      await writeTextFile(path, next.join("\n\n\n") + "\n");
      await onWritten?.(next, touched);
      await onReload();
      notifications.show({
        title: t("Board.Tabs.Headers"),
        message: t("Headers.Recompute.Done", { n: touched.length }),
        color: "teal",
      });
    } catch (e) {
      notifications.show({ title: t("Board.Tabs.Headers"), message: String(e), color: "red" });
    } finally {
      setBusy(false);
    }
  }

  const cols = viewMode === "full" ? FULL_COLS : STANDARD_COLS;

  return (
    <Stack flex={1} gap="xs" style={{ minHeight: 0 }}>
      <Group justify="space-between" wrap="wrap" gap="xs">
        {editMode ? (
          <>
            <Text size="sm" c="dimmed">
              {t("Headers.EditModeNote")}
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={cancelEdit}>
                {t("Headers.Cancel")}
              </Button>
              <Button size="xs" loading={busy} onClick={saveEdits}>
                {t("Headers.Save", { n: dirtyCount })}
              </Button>
            </Group>
          </>
        ) : (
          <>
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              data={[
                { value: "standard", label: t("Headers.View.Standard") },
                { value: "full", label: t("Headers.View.Full") },
                ...(matchView ? [{ value: "match", label: t("Headers.View.Match") }] : []),
              ]}
            />
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                disabled={shown.length === 0}
                onClick={enterEditMode}
              >
                {t("Headers.Edit")}
              </Button>
              <Menu shadow="md" position="bottom-end">
                <Menu.Target>
                  <Button size="xs" variant="default" loading={busy} disabled={shown.length === 0}>
                    {t("Headers.Recompute.Button")}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>{t("Headers.Recompute.Label")}</Menu.Label>
                  <Menu.Item onClick={() => recompute("all")}>
                    {t("Headers.Recompute.All")}
                  </Menu.Item>
                  <Menu.Item onClick={() => recompute("empty")}>
                    {t("Headers.Recompute.Empty")}
                  </Menu.Item>
                  {canRecomputeActive && (
                    <Menu.Item onClick={() => recompute("selected")}>
                      {t("Headers.Recompute.Selected")}
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
              {toolbar}
            </Group>
          </>
        )}
      </Group>

      {loading ? (
        <Text c="dimmed" size="sm">
          {t("Common.Loading")}
        </Text>
      ) : shown.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("Headers.NoGames")}
        </Text>
      ) : viewMode === "match" ? (
        <MatchTable shown={shown} activeIndex={activeIndex} onOpen={onOpen} t={t} />
      ) : (
        <ScrollArea style={{ flex: 1 }}>
          <Table stickyHeader highlightOnHover withRowBorders={false} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 32, textAlign: "right" }}>#</Table.Th>
                {cols.map((c) => (
                  <Table.Th key={c.h} style={{ whiteSpace: "nowrap" }}>
                    <Group gap={4} wrap="nowrap">
                      {c.sq && c.tone && <ColSquare white={c.tone === "white"} />}
                      {t(c.labelKey)}
                    </Group>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map(({ index, g }) => {
                const active = index === activeIndex;
                return (
                  <Table.Tr
                    key={index}
                    bg={active ? "var(--mantine-primary-color-light)" : undefined}
                    style={{ cursor: editMode || !onOpen ? "default" : "pointer" }}
                    onClick={editMode || !onOpen ? undefined : () => onOpen(index)}
                  >
                    <Table.Td c="dimmed" ta="right">
                      {index + 1}
                    </Table.Td>
                    {cols.map((c) => {
                      const orig =
                        c.h === "PlyCount"
                          ? String(countPlies(g.movetext))
                          : (getTag(g.tags, c.h) ?? "");
                      if (editMode && c.h !== "PlyCount") {
                        const edited = edits[index]?.[c.h];
                        return (
                          <Table.Td key={c.h} p={2}>
                            <TextInput
                              size="xs"
                              variant="filled"
                              styles={{
                                input: {
                                  width: c.w ?? 90,
                                  minHeight: "1.6rem",
                                  height: "1.6rem",
                                  backgroundColor:
                                    edited !== undefined
                                      ? "var(--mantine-color-yellow-light)"
                                      : undefined,
                                },
                              }}
                              value={edited ?? orig}
                              onChange={(e) => setCell(index, c.h, e.currentTarget.value, orig)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Table.Td>
                        );
                      }
                      return (
                        <Table.Td
                          key={c.h}
                          style={{
                            whiteSpace: "nowrap",
                            textAlign: c.center ? "center" : undefined,
                          }}
                        >
                          {c.h === "Result" ? (
                            <Text span fz="xs" fw={500} c={resultColor(orig)}>
                              {orig || "*"}
                            </Text>
                          ) : (
                            orig || "—"
                          )}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}

// Zápasový pohled — board order, home/away by board parity, board-perspective
// result, moves and ECO, mirroring pgn-base's MatchView.
function MatchTable({
  shown,
  activeIndex,
  onOpen,
  t,
}: {
  shown: Row[];
  activeIndex?: number;
  onOpen?: (index: number) => void;
  t: (key: string) => string;
}) {
  const rows = useMemo(() => {
    return shown
      .map(({ g, index }) => ({ g, index, board: parseInt(getTag(g.tags, "Board") ?? "", 10) }))
      .sort(
        (a, b) =>
          (Number.isFinite(a.board) ? a.board : 999) - (Number.isFinite(b.board) ? b.board : 999),
      );
  }, [shown]);

  const summary = useMemo(() => {
    let home = 0;
    let away = 0;
    let any = false;
    let homeTeam = "";
    let awayTeam = "";
    for (const { g, board } of rows) {
      if (!Number.isFinite(board)) continue;
      const homeIsWhite = board % 2 === 1;
      const result = getTag(g.tags, "Result") ?? "";
      if (board === 1) {
        homeTeam = getTag(g.tags, "WhiteTeam") ?? "";
        awayTeam = getTag(g.tags, "BlackTeam") ?? "";
      }
      if (result === "1-0") {
        if (homeIsWhite) home += 1;
        else away += 1;
        any = true;
      } else if (result === "0-1") {
        if (homeIsWhite) away += 1;
        else home += 1;
        any = true;
      } else if (result === "1/2-1/2") {
        home += 0.5;
        away += 0.5;
        any = true;
      }
    }
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
    return { home, away, any, homeTeam, awayTeam, fmt };
  }, [rows]);

  return (
    <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
      {(summary.homeTeam || summary.awayTeam) && (
        <Text size="sm">
          {summary.homeTeam || "?"} – {summary.awayTeam || "?"}
          {" · "}
          <Text
            span
            fw={600}
            c={
              summary.home > summary.away ? "teal" : summary.home < summary.away ? "red" : "dimmed"
            }
          >
            {summary.any ? `${summary.fmt(summary.home)}:${summary.fmt(summary.away)}` : "?:?"}
          </Text>
        </Text>
      )}
      <ScrollArea style={{ flex: 1 }}>
        <Table stickyHeader highlightOnHover withRowBorders={false} fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th ta="center">{t("Headers.Match.Board")}</Table.Th>
              <Table.Th>{t("Headers.Match.Home")}</Table.Th>
              <Table.Th>{t("Headers.Match.Away")}</Table.Th>
              <Table.Th ta="center">{t("Headers.Col.Result")}</Table.Th>
              <Table.Th ta="right">{t("Headers.Match.Moves")}</Table.Th>
              <Table.Th>{t("Headers.Col.ECO")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ g, index, board }) => {
              const homeIsWhite = Number.isFinite(board) && board % 2 === 1;
              const white = getTag(g.tags, "White") ?? "?";
              const black = getTag(g.tags, "Black") ?? "?";
              const whiteElo = getTag(g.tags, "WhiteElo");
              const blackElo = getTag(g.tags, "BlackElo");
              const homePlayer = homeIsWhite ? white : black;
              const homeElo = homeIsWhite ? whiteElo : blackElo;
              const awayPlayer = homeIsWhite ? black : white;
              const awayElo = homeIsWhite ? blackElo : whiteElo;
              const result = getTag(g.tags, "Result") ?? "";
              const br = boardResult(result, homeIsWhite);
              const eco = getTag(g.tags, "ECO");
              const plies = countPlies(g.movetext);
              return (
                <Table.Tr
                  key={index}
                  bg={index === activeIndex ? "var(--mantine-primary-color-light)" : undefined}
                  style={{ cursor: onOpen ? "pointer" : "default" }}
                  onClick={onOpen ? () => onOpen(index) : undefined}
                >
                  <Table.Td ta="center" fw={500}>
                    {getTag(g.tags, "Board") || "?"}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <span>
                        {homePlayer}
                        {homeElo ? ` (${homeElo})` : ""}
                      </span>
                      <ColSquare white={homeIsWhite} />
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <span>
                        {awayPlayer}
                        {awayElo ? ` (${awayElo})` : ""}
                      </span>
                      <ColSquare white={!homeIsWhite} />
                    </Group>
                  </Table.Td>
                  <Table.Td ta="center" fw={500} c={br.color}>
                    {br.text}
                  </Table.Td>
                  <Table.Td ta="right" c={plies ? undefined : "dimmed"}>
                    {plies ? Math.ceil(plies / 2) : "—"}
                  </Table.Td>
                  <Table.Td c={eco ? undefined : "dimmed"} ff="monospace">
                    {eco || "—"}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

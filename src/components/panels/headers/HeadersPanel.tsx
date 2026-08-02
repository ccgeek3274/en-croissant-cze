// "Hlavičky" — a faithful port of pgn-base's database grid, adapted to en-croissant.
// It lists every game in the current tab's .pgn file as a data grid of PGN tags,
// with Standardní / Plný / Zápasový views, inline bulk editing (Upravit) written
// back to disk, and the shared Kontrola report (reused from PgnToolsDialogs).

import {
  Button,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { commands } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { KontrolaModal } from "@/components/files/PgnToolsDialogs";
import ConfirmChangesModal from "@/components/tabs/ConfirmChangesModal";
import { currentTabAtom } from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { setGameTag } from "@/utils/pgn/check";
import { getTag, splitGame } from "@/utils/pgn/tags";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";

type ViewMode = "standard" | "full" | "match";

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

function HeadersPanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const dirty = useStore(store, (s) => s.dirty);
  const setState = useStore(store, (s) => s.setState);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const gameNumber = getTabGameNumber(currentTab);
  const isMatch = tabFile?.metadata.type === "tournament";

  const [games, setGames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kontrolaOpen, setKontrolaOpen] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem("headers-view-mode");
    return s === "full" || s === "match" ? s : "standard";
  });
  useEffect(() => {
    localStorage.setItem("headers-view-mode", viewMode);
  }, [viewMode]);
  // The match view only makes sense for match (tournament) files.
  useEffect(() => {
    if (!isMatch && viewMode === "match") setViewMode("standard");
  }, [isMatch, viewMode]);

  // Inline bulk editing: edits[gameIndex][tag] = new value (diffs only).
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const dirtyCount = Object.keys(edits).length;
  // "Upravit" from the match view opens the standard table; leaving edit returns.
  const returnToMatchRef = useRef(false);

  // Confirm-changes modal shared with game navigation (unsaved board analysis).
  const [confirmChanges, toggleConfirmChanges] = useToggle();
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  const path = tabFile?.path;
  const numGames = tabFile?.numGames ?? 0;

  const reload = useCallback(async () => {
    if (!path || numGames <= 0) {
      setGames([]);
      return;
    }
    setLoading(true);
    try {
      setGames(unwrap(await commands.readGames(path, 0, numGames - 1)));
    } finally {
      setLoading(false);
    }
  }, [path, numGames]);

  useEffect(() => {
    reload();
  }, [reload]);

  const parsed = useMemo(() => games.map((g) => splitGame(g)), [games]);

  async function loadGame(index: number, forced?: boolean) {
    if (!path) return;
    if (!forced && dirty) {
      setPendingIdx(index);
      toggleConfirmChanges();
      return;
    }
    const data = unwrap(await commands.readGames(path, index, index));
    setState(await parsePGN(data[0]));
    setCurrentTab((prev) => {
      if (prev.gameOrigin.kind !== "file" && prev.gameOrigin.kind !== "temp_file") return prev;
      return { ...prev, gameOrigin: { ...prev.gameOrigin, gameNumber: index } };
    });
  }

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
      for (const [idxStr, cellEdits] of Object.entries(edits)) {
        const idx = Number(idxStr);
        let g = next[idx];
        for (const [tag, value] of Object.entries(cellEdits)) g = setGameTag(g, tag, value);
        next[idx] = g;
      }
      const touchedCurrent = edits[gameNumber] !== undefined;
      await writeTextFile(path, next.join("\n\n\n") + "\n");
      const saved = dirtyCount;
      setEdits({});
      leaveEditMode();
      // Refresh the open board only when it has no unsaved moves of its own,
      // so we never clobber in-progress analysis with the on-disk version.
      if (touchedCurrent && !dirty) {
        setState(await parsePGN(next[gameNumber]));
      }
      await reload();
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

  if (!tabFile) {
    return (
      <Text p="sm" c="dimmed">
        {t("Headers.NoFile")}
      </Text>
    );
  }

  const cols = viewMode === "full" ? FULL_COLS : STANDARD_COLS;

  return (
    <Stack h="100%" gap="xs" p="xs">
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
                ...(isMatch ? [{ value: "match", label: t("Headers.View.Match") }] : []),
              ]}
            />
            <Group gap="xs">
              <Button size="xs" variant="default" disabled={numGames === 0} onClick={enterEditMode}>
                {t("Headers.Edit")}
              </Button>
              <Button size="xs" variant="default" onClick={() => setKontrolaOpen(true)}>
                {t("PgnTools.Kontrola.Title")}
              </Button>
            </Group>
          </>
        )}
      </Group>

      {loading ? (
        <Text c="dimmed" size="sm">
          {t("Common.Loading")}
        </Text>
      ) : parsed.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("Headers.NoGames")}
        </Text>
      ) : viewMode === "match" ? (
        <MatchTable parsed={parsed} gameNumber={gameNumber} onOpen={loadGame} t={t} />
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
              {parsed.map((g, index) => {
                const active = index === gameNumber;
                return (
                  <Table.Tr
                    key={index}
                    bg={active ? "var(--mantine-primary-color-light)" : undefined}
                    style={{ cursor: editMode ? "default" : "pointer" }}
                    onClick={editMode ? undefined : () => loadGame(index)}
                  >
                    <Table.Td c="dimmed" ta="right">
                      {index + 1}
                    </Table.Td>
                    {cols.map((c) => {
                      const orig =
                        c.h === "PlyCount"
                          ? String(countPlies(games[index]))
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

      <ConfirmChangesModal
        opened={confirmChanges}
        toggle={toggleConfirmChanges}
        closeTab={() => {
          if (pendingIdx !== null) void loadGame(pendingIdx, true);
        }}
      />
      <KontrolaModal
        opened={kontrolaOpen}
        onClose={() => setKontrolaOpen(false)}
        file={tabFile}
        onChanged={reload}
      />
    </Stack>
  );
}

// Zápasový pohled — board order, home/away by board parity, board-perspective
// result, moves and ECO, mirroring pgn-base's MatchView.
function MatchTable({
  parsed,
  gameNumber,
  onOpen,
  t,
}: {
  parsed: ReturnType<typeof splitGame>[];
  gameNumber: number;
  onOpen: (index: number) => void;
  t: (key: string) => string;
}) {
  const rows = useMemo(() => {
    return parsed
      .map((g, index) => ({ g, index, board: parseInt(getTag(g.tags, "Board") ?? "", 10) }))
      .sort(
        (a, b) =>
          (Number.isFinite(a.board) ? a.board : 999) - (Number.isFinite(b.board) ? b.board : 999),
      );
  }, [parsed]);

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
                  bg={index === gameNumber ? "var(--mantine-primary-color-light)" : undefined}
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpen(index)}
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

export default HeadersPanel;

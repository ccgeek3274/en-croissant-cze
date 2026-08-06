// "Vedoucí soutěže" — the working mode for a whole season.
//
// Left: the competition → round → match → game tree, every node showing how far
// along it is (moves in / results in / placeholders left). Right: the games of the
// selected node in the board's own "Hlavičky" grid, plus the tools scoped to exactly
// that level. Selecting a node is the only piece of state that matters — everything
// else is derived from it, which is what makes "edit headers at match level, check at
// round level, export the season" one mechanism instead of three. That selection is
// remembered per file and travels with a game onto the board, so drilling down is
// never undone by switching tabs.

import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconChevronRight,
  IconFileExport,
  IconFileImport,
  IconListCheck,
  IconRefresh,
  IconTags,
  IconTrophy,
} from "@tabler/icons-react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { distinctTagValues, setGameTag, TAG_DEFS } from "@/utils/pgn/check";
import { getTag, splitGame } from "@/utils/pgn/tags";
import { labelMapFrom } from "@/utils/sscr/directory";
import { defaultEventPrefix, exportFileBase } from "@/utils/sscr/export";
import { isUninformative } from "@/utils/sscr/sync";
import type { CompetitionManifest } from "@/utils/sscr/manifest";
import { loadCompetition } from "@/utils/sscr/storage";
import {
  allGameNodes,
  buildTree,
  type CompetitionNode,
  findScope,
  formatScore,
  type GameNode,
  type MatchNode,
  type NodeStats,
  type RoundNode,
  type Scope,
} from "@/utils/sscr/tree";
import type { GameScope } from "@/utils/tabs";
import { HeadersGrid } from "@/components/panels/headers/HeadersGrid";
import { CompetitionResyncModal } from "./CompetitionDialogs";
import type { FileMetadata } from "./file";
import { ExportPgnModal, ImportGamesModal, KontrolaModal, type ToolScope } from "./PgnToolsDialogs";
import { CompetitionLabelsDialog, SscrExportModal } from "./SscrExportDialogs";

/** A Badge's own text sits this far inside its right edge — 6px of `xs` padding
 *  plus the 1px transparent border. Right slots that are plain text pad by the
 *  same amount, so a game's result lines up with the progress badges of the
 *  match and round above it instead of hanging past them. */
const BADGE_TEXT_INSET = 7;

/** "12/48" style progress, coloured by how done it is. */
function Progress({ done, total }: { done: number; total: number }) {
  const color = total === 0 ? "gray" : done === total ? "teal" : done === 0 ? "gray" : "orange";
  return (
    <Badge size="xs" variant="light" color={color}>
      {done}/{total}
    </Badge>
  );
}

function TreeRow({
  depth,
  selected,
  onClick,
  expandable,
  expanded,
  onToggle,
  label,
  right,
}: {
  depth: number;
  selected: boolean;
  onClick: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  label: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Group
      gap={4}
      wrap="nowrap"
      pl={8 + depth * 14}
      pr={8}
      py={2}
      bg={selected ? "var(--mantine-color-default-hover)" : undefined}
      style={{ borderRadius: 4 }}
    >
      {expandable ? (
        <ActionIcon
          size="xs"
          variant="subtle"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </ActionIcon>
      ) : (
        <div style={{ width: 18 }} />
      )}
      <UnstyledButton onClick={onClick} style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" truncate fw={selected ? 600 : 400}>
          {label}
        </Text>
      </UnstyledButton>
      {right}
    </Group>
  );
}

// ── tree pane width ─────────────────────────────────────────────────────────
// A whole season's tree is deep ("11. kolo" → "Sedlčany A – Klokani z Kralup" →
// eight games), so no single width is right for everyone. The pane is dragged, and
// the choice is global — it is a habit, not a property of one competition.

const TREE_WIDTH_KEY = "competition-tree-width";
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 720;
const TREE_WIDTH_DEFAULT = 320;

function clampTreeWidth(px: number): number {
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(px)));
}

// ── remembering where you were ──────────────────────────────────────────────
// Tab panels unmount when you switch away — BoardsPage renders them with
// `keepMounted={false}` — so the mode used to come back at the root with every
// branch collapsed. After eleven rounds that is a lot of clicking to get back to
// the match you were working on. The selection *is* the state of this mode, so
// remembering it and the open branches, per file, restores the whole view.

const TREE_STATE_KEY = "competition-tree-state";
/** How many competitions to remember. Enough for a season's worth of files. */
const TREE_STATE_KEEP = 20;

type TreeState = { selectedId: string; expanded: string[] };

function readTreeStates(): [string, TreeState][] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TREE_STATE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, TreeState>).filter(
      ([, v]) => typeof v?.selectedId === "string" && Array.isArray(v?.expanded),
    );
  } catch {
    return [];
  }
}

function loadTreeState(path: string): TreeState | undefined {
  return readTreeStates().find(([p]) => p === path)?.[1];
}

function saveTreeState(path: string, state: TreeState): void {
  // Object key order is insertion order, so re-appending the file we just touched
  // makes the tail the most-recently-used and `slice` the eviction policy.
  const kept = [...readTreeStates().filter(([p]) => p !== path), [path, state] as const].slice(
    -TREE_STATE_KEEP,
  );
  try {
    localStorage.setItem(TREE_STATE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // A full quota is not worth failing a render over.
  }
}

function useTreeWidth(): [number, (px: number) => void] {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(TREE_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampTreeWidth(stored) : TREE_WIDTH_DEFAULT;
  });
  return [
    width,
    (px: number) => {
      const next = clampTreeWidth(px);
      setWidth(next);
      localStorage.setItem(TREE_WIDTH_KEY, String(next));
    },
  ];
}

/** The draggable border between the tree and the game list. Doubles as the divider,
 *  so nothing moves when it appears. */
function TreeResizer({ width, onWidth }: { width: number; onWidth: (px: number) => void }) {
  const [dragging, setDragging] = useState(false);

  function start(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setDragging(true);
    // Pointer capture on the window, not the handle: the cursor routinely outruns a
    // 5px strip, and losing the drag there feels broken.
    const move = (ev: PointerEvent) => onWidth(startWidth + ev.clientX - startX);
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard resizing is covered by
    // the arrow keys below, on a focusable separator.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize tree"
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidth(width - 16);
        else if (e.key === "ArrowRight") onWidth(width + 16);
        else return;
        e.preventDefault();
      }}
      onDoubleClick={() => onWidth(TREE_WIDTH_DEFAULT)}
      style={{
        flex: "0 0 auto",
        width: 5,
        cursor: "col-resize",
        alignSelf: "stretch",
        backgroundColor: dragging
          ? "var(--mantine-color-blue-5)"
          : "var(--mantine-color-default-border)",
      }}
    />
  );
}

function StatsLine({ stats }: { stats: NodeStats }) {
  const { t } = useTranslation();
  return (
    <Group gap="lg">
      <Text size="xs" c="dimmed">
        {t("Competition.Stats.Games")}: <b>{stats.total}</b>
      </Text>
      <Text size="xs" c="dimmed">
        {t("Competition.Stats.WithMoves")}: <b>{stats.withMoves}</b>
      </Text>
      <Text size="xs" c="dimmed">
        {t("Competition.Stats.Decided")}: <b>{stats.decided}</b>
      </Text>
      <Text size="xs" c={stats.placeholders > 0 ? "orange" : "dimmed"}>
        {t("Competition.Stats.Placeholders")}: <b>{stats.placeholders}</b>
      </Text>
      <Text size="xs" c="dimmed">
        {t("Competition.Stats.Forfeits")}: <b>{stats.forfeits}</b>
      </Text>
    </Group>
  );
}

export function CompetitionView({
  file,
  onChanged,
  onOpenGame,
}: {
  file: FileMetadata;
  /** The file on disk changed — refresh the surrounding file list. */
  onChanged: () => void;
  /** Open one game on the board (game number = its index in the file), carrying the
   *  level it was opened from so the board lists that level and not the whole file. */
  onOpenGame: (gameIndex: number, scope: GameScope) => void;
}) {
  const { t } = useTranslation();

  const [games, setGames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<CompetitionManifest | null>(null);
  const [restored] = useState(() => loadTreeState(file.path));
  const [selectedId, setSelectedId] = useState(restored?.selectedId ?? "competition");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(restored?.expanded ?? ["competition"]),
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [treeWidth, setTreeWidth] = useTreeWidth();
  const [tagsOpen, setTagsOpen] = useState(false);

  const [kontrolaOpen, setKontrolaOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sscrOpen, setSscrOpen] = useState(false);

  // Tag editor (the "work on headers at any level" part).
  const [tagKey, setTagKey] = useState("Event");
  const [desired, setDesired] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGames(null);
    loadCompetition(file.path).then((loaded) => {
      if (cancelled) return;
      setGames(loaded?.games ?? []);
      setManifest(loaded?.manifest ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [file.path, reloadKey]);

  // One tab, one competition — but if this ever gets pointed at another file, the
  // restored selection belongs to the old one.
  const pathRef = useRef(file.path);
  useEffect(() => {
    if (pathRef.current === file.path) return;
    pathRef.current = file.path;
    const saved = loadTreeState(file.path);
    setSelectedId(saved?.selectedId ?? "competition");
    setExpanded(new Set(saved?.expanded ?? ["competition"]));
  }, [file.path]);

  useEffect(() => {
    saveTreeState(file.path, { selectedId, expanded: [...expanded] });
  }, [file.path, selectedId, expanded]);

  const tree: CompetitionNode | null = useMemo(
    () => (games ? buildTree(games, manifest) : null),
    [games, manifest],
  );

  const scope: Scope | null = useMemo(
    () => (tree ? (findScope(tree, selectedId) ?? findScope(tree, "competition")) : null),
    [tree, selectedId],
  );

  // A remembered node can be gone — the file was re-synced, a round renumbered. Fall
  // back to the whole competition rather than leaving a selection nothing matches.
  useEffect(() => {
    if (tree && !findScope(tree, selectedId)) setSelectedId("competition");
  }, [tree, selectedId]);

  // The competition itself is not a match — its Event is uniform by construction and
  // colours alternate per match, not across the file.
  const isMatchScope = selectedId !== "competition" && selectedId.includes(".");
  const toolScope: ToolScope | undefined = scope
    ? { indices: scope.indices, label: scope.label }
    : undefined;

  const scopedGames = useMemo(
    () => (games && scope ? scope.indices.map((i) => games[i]) : []),
    [games, scope],
  );
  const tagValues = useMemo(() => distinctTagValues(scopedGames, tagKey), [scopedGames, tagKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
    onChanged();
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Picking a node also opens it: drilling down is what the leader is here for.
  function select(id: string) {
    setSelectedId(id);
    setExpanded((prev) => new Set(prev).add(id));
    setChecked(new Set());
  }

  async function replaceTag() {
    if (!games || !scope || checked.size === 0) return;
    setBusy(true);
    try {
      const target = desired.trim();
      const wanted = new Set(scope.indices);
      const next = games.map((g, i) =>
        wanted.has(i) && checked.has((getTag(splitGame(g).tags, tagKey) ?? "").trim())
          ? setGameTag(g, tagKey, target)
          : g,
      );
      await writeTextFile(file.path, next.join("\n\n\n") + "\n");
      notifications.show({
        title: t("Competition.Headers.Title"),
        message: t("Competition.Headers.Done", { tag: tagKey, count: checked.size }),
        color: "teal",
      });
      setChecked(new Set());
      setDesired("");
      refresh();
    } catch (e) {
      notifications.show({
        title: t("Competition.Headers.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!tree || !scope) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }

  return (
    <Stack h="100%" gap={0}>
      <Group justify="space-between" px="sm" py="xs" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fw={700} truncate>
            {tree.name || file.name}
          </Text>
          <StatsLine stats={scope.id === tree.id ? tree.stats : statsOf(tree, scope)} />
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={t("PgnTools.Kontrola.Title")}>
            <ActionIcon variant="default" onClick={() => setKontrolaOpen(true)}>
              <IconListCheck size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("PgnTools.Import.Title")}>
            <ActionIcon variant="default" onClick={() => setImportOpen(true)}>
              <IconFileImport size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("PgnTools.Export.Title")}>
            <ActionIcon variant="default" onClick={() => setExportOpen(true)}>
              <IconFileExport size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Competition.Labels.Title")}>
            <ActionIcon variant="default" onClick={() => setLabelsOpen(true)}>
              <IconTags size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Competition.Export.Title")}>
            <ActionIcon variant="filled" onClick={() => setSscrOpen(true)}>
              <IconTrophy size="1rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Competition.Sync.Title")}>
            <ActionIcon variant="default" onClick={() => setResyncOpen(true)}>
              <IconRefresh size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Divider />

      {/* `wrap="nowrap"` is load-bearing, not cosmetic. Mantine's Group wraps by
          default, and in a *multi-line* flex container `align-items: stretch` sizes
          items to their line, whose height is the tallest item — so the tree and the
          game list grew to their content (4000px inside a 600px pane) and their
          ScrollAreas had nothing to clip. With nowrap the single line is the
          container's own height, and both panes scroll. */}
      <Group
        flex={1}
        gap={0}
        align="stretch"
        wrap="nowrap"
        style={{ overflow: "hidden", minHeight: 0 }}
      >
        {/* ── tree ─────────────────────────────────────────────────────── */}
        <Paper w={treeWidth} style={{ overflow: "hidden", flex: "0 0 auto" }}>
          <ScrollArea h="100%" type="auto">
            <Stack gap={0} py={4}>
              <TreeRow
                depth={0}
                selected={selectedId === tree.id}
                onClick={() => select(tree.id)}
                expandable
                expanded={expanded.has(tree.id)}
                onToggle={() => toggle(tree.id)}
                label={t("Competition.Node.Competition")}
                right={<Progress done={tree.stats.withMoves} total={tree.stats.total} />}
              />
              {expanded.has(tree.id) &&
                tree.rounds.map((round) => (
                  <RoundRows
                    key={round.id}
                    round={round}
                    expanded={expanded}
                    selectedId={selectedId}
                    onSelect={select}
                    onToggle={toggle}
                  />
                ))}
              {expanded.has(tree.id) &&
                tree.strays.map((stray) => (
                  <TreeRow
                    key={stray.id}
                    depth={1}
                    selected={selectedId === stray.id}
                    onClick={() => select(stray.id)}
                    label={`${t("Competition.Node.Stray")}: ${stray.white} – ${stray.black}`}
                  />
                ))}
            </Stack>
          </ScrollArea>
        </Paper>

        <TreeResizer width={treeWidth} onWidth={setTreeWidth} />

        {/* ── detail ───────────────────────────────────────────────────── */}
        <Stack flex={1} gap="xs" p="sm" style={{ overflow: "hidden", minWidth: 0 }}>
          <Text fw={600} size="sm">
            {scope.label}
          </Text>

          {/* The same grid the board's "Hlavičky" tab uses, over the games of the
              selected node — so one competition, one round, one match and one game
              are four scopes of one view rather than four different screens. Opening
              a game hands that scope to the board with it. */}
          <HeadersGrid
            path={file.path}
            games={games ?? []}
            rows={scope.indices}
            onOpen={(index) =>
              onOpenGame(index, {
                label: scope.label,
                indices: scope.indices,
                matchLevel: isMatchScope,
              })
            }
            onReload={refresh}
            matchView={isMatchScope}
            viewModeKey="competition-headers-view-mode"
            toolbar={
              <Button
                size="xs"
                variant={tagsOpen ? "light" : "default"}
                onClick={() => setTagsOpen((o) => !o)}
              >
                {t("Competition.Headers.Title")}
              </Button>
            }
          />

          {/* ── header editing, scoped to the selected node ─────────────── */}
          {tagsOpen && (
            <Paper withBorder p="xs">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={600} size="xs">
                    {t("Competition.Headers.Title")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Competition.Headers.Scope", {
                      label: scope.label,
                      count: scope.indices.length,
                    })}
                  </Text>
                </Group>
                <Select
                  size="xs"
                  w={200}
                  label={t("PgnTools.Check.Tags.SelectTag")}
                  data={TAG_DEFS.filter((d) => d.replaceable).map((d) => d.key)}
                  value={tagKey}
                  onChange={(v) => {
                    if (v) setTagKey(v);
                    setChecked(new Set());
                    setDesired("");
                  }}
                  comboboxProps={{ withinPortal: true }}
                  allowDeselect={false}
                />
                <ScrollArea.Autosize mah={140}>
                  <Stack gap={2}>
                    {tagValues.map(({ value, count, suspicious }) => (
                      <Group key={value || "∅"} gap="xs" wrap="nowrap">
                        <Checkbox
                          size="xs"
                          checked={checked.has(value)}
                          onChange={() =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(value)) next.delete(value);
                              else next.add(value);
                              return next;
                            })
                          }
                        />
                        <Text size="xs" c={suspicious ? "red" : undefined} style={{ flex: 1 }}>
                          {value || t("PgnTools.Check.Tags.Empty")}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {count}×
                        </Text>
                        {value !== "" && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => setDesired(value)}
                          >
                            {t("PgnTools.Check.Tags.Take")}
                          </Button>
                        )}
                      </Group>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    size="xs"
                    placeholder={t("PgnTools.Check.Tags.Desired")}
                    value={desired}
                    onChange={(e) => setDesired(e.currentTarget.value)}
                  />
                  <Button
                    size="xs"
                    loading={busy}
                    disabled={checked.size === 0}
                    onClick={replaceTag}
                  >
                    {t("PgnTools.Check.Tags.Replace", { n: checked.size })}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Group>

      <KontrolaModal
        opened={kontrolaOpen}
        onClose={() => setKontrolaOpen(false)}
        file={file}
        onChanged={refresh}
        scope={toolScope}
        matchChecks={isMatchScope}
      />
      <ExportPgnModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        file={file}
        scope={toolScope}
        matchChecks={isMatchScope}
      />
      <ImportGamesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        file={file}
        onChanged={refresh}
        scope={toolScope}
      />
      <CompetitionResyncModal
        opened={resyncOpen}
        onClose={() => setResyncOpen(false)}
        pgnPath={file.path}
        onChanged={refresh}
      />
      <CompetitionLabelsDialog
        opened={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        pgnPath={file.path}
        onSaved={refresh}
      />
      <SscrExportModal
        opened={sscrOpen}
        onClose={() => setSscrOpen(false)}
        pgnPath={file.path}
        indices={scope.indices}
        scopeLabel={scope.label}
        defaultFileName={exportFileName(file.name, scope.id, tree, manifest)}
      />
    </Stack>
  );
}

function RoundRows({
  round,
  expanded,
  selectedId,
  onSelect,
  onToggle,
}: {
  round: RoundNode;
  expanded: Set<string>;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <TreeRow
        depth={1}
        selected={selectedId === round.id}
        onClick={() => onSelect(round.id)}
        expandable
        expanded={expanded.has(round.id)}
        onToggle={() => onToggle(round.id)}
        label={`${t("Competition.RoundNr", { n: round.roundNr })}${round.date ? ` · ${round.date}` : ""}`}
        right={<Progress done={round.stats.withMoves} total={round.stats.total} />}
      />
      {expanded.has(round.id) &&
        round.matches.map((match) => (
          <MatchRows
            key={match.id}
            match={match}
            expanded={expanded}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

function MatchRows({
  match,
  expanded,
  selectedId,
  onSelect,
  onToggle,
}: {
  match: MatchNode;
  expanded: Set<string>;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      <TreeRow
        depth={2}
        selected={selectedId === match.id}
        onClick={() => onSelect(match.id)}
        expandable
        expanded={expanded.has(match.id)}
        onToggle={() => onToggle(match.id)}
        label={`${match.homeTeam} – ${match.awayTeam}`}
        right={
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {formatScore(match.homeScore, match.awayScore)}
            </Text>
            <Progress done={match.stats.withMoves} total={match.stats.total} />
          </Group>
        }
      />
      {expanded.has(match.id) &&
        match.games.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            selected={selectedId === game.id}
            onSelect={() => onSelect(game.id)}
          />
        ))}
    </>
  );
}

function GameRow({
  game,
  selected,
  onSelect,
}: {
  game: GameNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TreeRow
      depth={3}
      selected={selected}
      onClick={onSelect}
      label={`${game.boardNr}. ${game.white} – ${game.black}`}
      right={
        <Text size="xs" pr={BADGE_TEXT_INSET} c={game.hasMoves ? "teal" : "dimmed"}>
          {game.result}
        </Text>
      }
    />
  );
}

/** Suggested export file name for the selected node: the round's own pattern
 *  ("ksa_01"), a match's Event, a game's players — see `exportFileBase`. */
function exportFileName(
  base: string,
  scopeId: string,
  tree: CompetitionNode,
  manifest: CompetitionManifest | null,
): string {
  return exportFileBase(
    scopeId,
    tree,
    {
      prefix:
        manifest?.options.eventPrefix ??
        (manifest ? defaultEventPrefix(manifest.competition.name, manifest.competition.year) : ""),
      eventPattern: manifest?.options.eventPattern,
      filePattern: manifest?.options.filePattern,
      labelByTeamName: manifest ? labelMapFrom(manifest) : undefined,
    },
    base,
  );
}

/** Stats for a non-root scope, found by walking the tree for the matching node. */
function statsOf(tree: CompetitionNode, scope: Scope): NodeStats {
  for (const round of tree.rounds) {
    if (round.id === scope.id) return round.stats;
    for (const match of round.matches) {
      if (match.id === scope.id) return match.stats;
    }
  }
  const wanted = new Set(scope.indices);
  const nodes = allGameNodes(tree).filter((n) => wanted.has(n.index));
  return {
    total: nodes.length,
    withMoves: nodes.filter((n) => n.hasMoves).length,
    decided: nodes.filter((n) => n.result !== "*" && n.result !== "").length,
    placeholders: nodes.filter((n) => isUninformative(n.white) || isUninformative(n.black)).length,
    forfeits: nodes.filter((n) => n.forfeit).length,
  };
}

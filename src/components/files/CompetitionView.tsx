// "Vedoucí soutěže" — the working mode for a whole season.
//
// Left: the competition → round → match → game tree, every node showing how far
// along it is (moves in / results in / placeholders left). Right: the games of the
// selected node, plus the tools scoped to exactly that level. Selecting a node is
// the only piece of state that matters — everything else is derived from it, which
// is what makes "edit headers at match level, check at round level, export the
// season" one mechanism instead of three.

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
  Table,
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
  IconZoomCheck,
} from "@tabler/icons-react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
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
import { CompetitionResyncModal } from "./CompetitionDialogs";
import type { FileMetadata } from "./file";
import { ExportPgnModal, ImportGamesModal, KontrolaModal, type ToolScope } from "./PgnToolsDialogs";
import { CompetitionLabelsDialog, SscrExportModal } from "./SscrExportDialogs";

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
  /** Open one game on the board (game number = its index in the file). */
  onOpenGame: (gameIndex: number) => void;
}) {
  const { t } = useTranslation();

  const [games, setGames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<CompetitionManifest | null>(null);
  const [selectedId, setSelectedId] = useState("competition");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["competition"]));
  const [reloadKey, setReloadKey] = useState(0);

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

  const tree: CompetitionNode | null = useMemo(
    () => (games ? buildTree(games, manifest) : null),
    [games, manifest],
  );

  const scope: Scope | null = useMemo(
    () => (tree ? (findScope(tree, selectedId) ?? findScope(tree, "competition")) : null),
    [tree, selectedId],
  );

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
  const scopedNodes = useMemo(() => {
    if (!tree || !scope) return [];
    const wanted = new Set(scope.indices);
    return allGameNodes(tree).filter((n) => wanted.has(n.index));
  }, [tree, scope]);

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

      <Group flex={1} gap={0} align="stretch" style={{ overflow: "hidden" }}>
        {/* ── tree ─────────────────────────────────────────────────────── */}
        <Paper
          w={320}
          style={{
            overflow: "hidden",
            borderRight: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <ScrollArea h="100%">
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

        {/* ── detail ───────────────────────────────────────────────────── */}
        <Stack flex={1} gap="xs" p="sm" style={{ overflow: "hidden" }}>
          <Text fw={600} size="sm">
            {scope.label}
          </Text>

          <ScrollArea flex={1}>
            <Table stickyHeader verticalSpacing={2} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={70}>{t("Competition.Col.Round")}</Table.Th>
                  <Table.Th>{t("Competition.Col.White")}</Table.Th>
                  <Table.Th>{t("Competition.Col.Black")}</Table.Th>
                  <Table.Th w={80}>{t("Competition.Col.Result")}</Table.Th>
                  <Table.Th w={70}>{t("Competition.Col.Moves")}</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {scopedNodes.map((node) => (
                  <Table.Tr key={node.id}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {node.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{node.white}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{node.black}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {node.result}
                        {node.forfeit && ` (${t("Competition.Forfeit")})`}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={node.hasMoves ? "teal" : "dimmed"}>
                        {node.hasMoves ? t("Competition.Moves.Yes") : t("Competition.Moves.No")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        aria-label={t("Common.Open")}
                        onClick={() => onOpenGame(node.index)}
                      >
                        <IconZoomCheck size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          {/* ── header editing, scoped to the selected node ─────────────── */}
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
                <Button size="xs" loading={busy} disabled={checked.size === 0} onClick={replaceTag}>
                  {t("PgnTools.Check.Tags.Replace", { n: checked.size })}
                </Button>
              </Group>
            </Stack>
          </Paper>
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
        <Text size="xs" c={game.hasMoves ? "teal" : "dimmed"}>
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

// Database-agnostic PGN tools exposed on a file: Kontrola (validate + clean),
// Export PGN (pgn-base-style options), Importovat partie (merge external games).
// They operate on the on-disk .pgn via the Rust read/write commands and the pure
// helpers in src/utils/pgn, so they work on any database, not just ŠSČR imports.

import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconFileImport, IconMinus } from "@tabler/icons-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { confirm as confirmDialog, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import {
  type ArtifactsCard,
  type CheckCard,
  type CheckStatus,
  type DiacriticsCard,
  distinctTagValues,
  type DuplicatesCard,
  type EventCard,
  type GameRef,
  pgncheck,
  removeGameVariations,
  type ResultCard,
  setGameTag,
  stripGameDiacritics,
  syncGameResult,
  TAG_DEFS,
  type TeamsCard,
  type VariationsCard,
} from "@/utils/pgn/check";
import { getEcoFromGame } from "@/utils/chess";
import { claimFileDrop } from "@/utils/fileDrop";
import { type CleanupOptions, FULL_CLEANUP } from "@/utils/pgn/cleanup";
import { buildExportGame, STANDARD_TAGS } from "@/utils/pgn/export";
import {
  applyMergedMovetext,
  matchLevel,
  type PairSide,
  pairSideFromTags,
  planMerge,
} from "@/utils/pgn/merge";
import { getTag, splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { unwrap } from "@/utils/unwrap";
import type { FileMetadata } from "./file";

async function readAllGames(file: FileMetadata): Promise<string[]> {
  if (file.numGames <= 0) return [];
  return unwrap(await commands.readGames(file.path, 0, file.numGames - 1));
}

/** Restricts a tool to part of a database — one round, one match, one game — as
 *  selected in the competition tree. `indices` point into the full game list; the
 *  tool works on that subset and splices its result back before writing. */
export type ToolScope = {
  indices: number[];
  label: string;
};

function pickScoped(all: string[], scope: ToolScope | undefined): string[] {
  if (!scope) return all;
  return scope.indices.map((i) => all[i]).filter((g) => g !== undefined);
}

function spliceScoped(all: string[], scope: ToolScope | undefined, next: string[]): string[] {
  if (!scope) return next;
  const out = [...all];
  scope.indices.forEach((fileIndex, i) => {
    if (next[i] !== undefined) out[fileIndex] = next[i];
  });
  return out;
}

// ————————————————————————————————————————————————————————————————
// Kontrola — a per-check card report (powered by the pure `pgncheck`) plus the
// fix actions each card offers. Every check runs on open; cards expand to show the
// affected games and the exact change a fix would make.

const STATUS_ICON: Record<CheckStatus, { icon: React.ReactNode; color: string }> = {
  ok: { icon: <IconCheck size={14} />, color: "teal" },
  warn: { icon: <IconAlertTriangle size={14} />, color: "orange" },
  unknown: { icon: <IconMinus size={14} />, color: "gray" },
};

/** "White – Black (round)" one-liner for an affected game. */
function refLabel(g: GameRef): string {
  const rb = g.round || g.board;
  return `${g.white || "?"} – ${g.black || "?"}${rb ? ` (${rb})` : ""}`;
}

function CardShell({
  status,
  title,
  detail,
  children,
}: {
  status: CheckStatus;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  const s = STATUS_ICON[status];
  return (
    <Accordion.Item value={title}>
      <Accordion.Control disabled={!children}>
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon size="sm" variant="light" color={s.color}>
            {s.icon}
          </ThemeIcon>
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {detail}
          </Text>
        </Group>
      </Accordion.Control>
      {children && <Accordion.Panel>{children}</Accordion.Panel>}
    </Accordion.Item>
  );
}

export function KontrolaModal({
  opened,
  onClose,
  file,
  onChanged,
  mode = "inplace",
  scope,
  matchChecks,
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
  /** Called after an in-place edit rewrites the source DB (ignored in export mode). */
  onChanged?: () => void;
  /** "inplace" writes fixes back to the source DB (Kontrola); "export" applies them
   *  to an in-memory working copy that is finally saved to a separate .pgn file. */
  mode?: "inplace" | "export";
  /** Restrict the report and its fixes to part of the database (competition tree). */
  scope?: ToolScope;
  /** Run the match-only checks (uniform Event, colour alternation across boards).
   *  Defaults to the file's type; the competition tree turns them off above match
   *  level, where "one Event, alternating colours" is not the invariant. */
  matchChecks?: boolean;
}) {
  const { t } = useTranslation();
  const isMatch = matchChecks ?? file.metadata.type === "tournament";
  const toolTitle = mode === "export" ? t("PgnTools.Export.Title") : t("PgnTools.Kontrola.Title");
  // `games` is what the report and the fixes see; `allGames` is the whole file, so a
  // scoped fix can be written back without touching anything outside the scope.
  const [allGames, setAllGames] = useState<string[]>([]);
  const [games, setGames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Movetext cleanup toggles (variations are handled per-game, so not here).
  const [opts, setOpts] = useState<CleanupOptions>(FULL_CLEANUP);
  // "Tagy" editor state.
  const [tagKey, setTagKey] = useState<string>("Event");
  const [checkedValues, setCheckedValues] = useState<Set<string>>(new Set());
  const [desired, setDesired] = useState("");
  // Export-only: which tags to write out, and the Standardní/Plné pre-selection.
  // "Standardní" is the default — an exported PGN is a deliverable for someone else,
  // and the internal bookkeeping tags (ids, team names, Termination) are ours.
  const [exportTags, setExportTags] = useState<Set<string>>(new Set());
  const [tagPreset, setTagPreset] = useState<"standard" | "full">("standard");
  // "Příjmení, Jméno" in White/Black. On for competition/match files, where every
  // source writes the name surname-first without the comma; off for a foreign PGN,
  // whose names may be in Western order and would come out wrong.
  const [normalizeNames, setNormalizeNames] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const all = await readAllGames(file);
      setAllGames(all);
      setGames(pickScoped(all, scope));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!opened) return;
    reload();
    setOpts(FULL_CLEANUP);
    setTagKey("Event");
    setCheckedValues(new Set());
    setDesired("");
    setTagPreset("standard");
    setNormalizeNames(isMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, file, scope]);

  const report = useMemo(() => pgncheck(games, { isMatch }), [games, isMatch]);
  const get = <T extends CheckCard>(id: CheckCard["id"]) =>
    report.cards.find((c) => c.id === id) as T | undefined;
  const artifacts = get<ArtifactsCard>("artifacts")!;
  const variations = get<VariationsCard>("variations")!;
  const diacritics = get<DiacriticsCard>("diacritics")!;
  const result = get<ResultCard>("result")!;
  const event = get<EventCard>("event");
  const teams = get<TeamsCard>("teams");
  const duplicates = get<DuplicatesCard>("duplicates")!;

  const tagDef = TAG_DEFS.find((d) => d.key === tagKey)!;
  const tagValues = useMemo(() => distinctTagValues(games, tagKey), [games, tagKey]);
  const maxCount = tagValues[0]?.count ?? 0;
  const tagsWarn = tagValues.some((v) => v.suspicious);

  // Export tag picker: every standard tag, then any non-standard tag actually
  // present in the games (in order of first appearance).
  const displayTags = useMemo(() => {
    const seen = new Set<string>(STANDARD_TAGS);
    const extra: string[] = [];
    for (const g of games) {
      for (const name of splitGame(g).tags.order) {
        if (!seen.has(name)) {
          seen.add(name);
          extra.push(name);
        }
      }
    }
    return [...STANDARD_TAGS, ...extra];
  }, [games]);

  // Re-apply the current preset when it changes or the tag universe changes.
  // Manual checkbox toggles don't touch either, so they persist.
  useEffect(() => {
    if (mode !== "export") return;
    setExportTags(new Set(tagPreset === "standard" ? STANDARD_TAGS : displayTags));
  }, [mode, tagPreset, displayTags]);

  // Apply `next`: in-place mode rewrites the source DB and re-checks; export mode
  // only updates the in-memory working copy (the source DB stays untouched — the
  // result is written out later by saveExport).
  async function commit(next: string[], msg?: string) {
    setBusy(true);
    try {
      if (mode === "export") {
        setGames(next);
      } else {
        await writeTextFile(file.path, spliceScoped(allGames, scope, next).join("\n\n\n") + "\n");
        await reload();
        onChanged?.();
      }
      notifications.show({
        title: toolTitle,
        message: msg ?? t("PgnTools.Check.Done"),
        color: "teal",
      });
    } catch (e) {
      notifications.show({
        title: toolTitle,
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  // Export mode: save the (possibly Kontrola-cleaned) working copy to a new .pgn.
  async function saveExport() {
    const dest = await save({
      defaultPath: `${file.name}.pgn`,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const keep = displayTags.filter((tag) => exportTags.has(tag));
      const out = games
        .map((g) =>
          buildExportGame(g, {
            headers: "all",
            keepTags: keep,
            cleanup: null,
            stripDiacritics: false,
            normalizeNames,
          }),
        )
        .join("\n\n\n");
      await writeTextFile(dest, out + "\n");
      notifications.show({
        title: toolTitle,
        message: t("PgnTools.Export.Done", { count: games.length }),
        color: "teal",
      });
      onClose();
    } catch (e) {
      notifications.show({
        title: toolTitle,
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  const applyAll = (transform: (g: string) => string) => commit(games.map(transform));
  const applyOne = (index: number, transform: (g: string) => string) =>
    commit(games.map((g, i) => (i === index ? transform(g) : g)));

  const cleanMovetext = () =>
    applyAll((g) => buildExportGame(g, { headers: "all", cleanup: opts, stripDiacritics: false }));

  async function removeVariations(index: number, info: VariationsCard["games"][number]["info"]) {
    // Keeping only the main line drops any deeper variation — confirm that loss.
    if (info.losesLongerLine) {
      const ok = await confirmDialog(
        t("PgnTools.Check.Variations.Confirm", {
          main: info.mainLinePlies,
          longest: info.longestPlies,
        }),
        { title: t("PgnTools.Check.Variations.Title") },
      );
      if (!ok) return;
    }
    applyOne(index, removeGameVariations);
  }

  function toggleValue(v: string) {
    setCheckedValues((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function toggleExportTag(tag: string) {
    setExportTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function replaceTag() {
    if (checkedValues.size === 0) return;
    if (!desired.trim()) {
      const ok = await confirmDialog(t("PgnTools.Check.Tags.ConfirmClear", { tag: tagKey }));
      if (!ok) return;
    }
    const target = desired.trim();
    await commit(
      games.map((g) =>
        checkedValues.has((getTag(splitGame(g).tags, tagKey) ?? "").trim())
          ? setGameTag(g, tagKey, target)
          : g,
      ),
    );
    setCheckedValues(new Set());
    setDesired("");
  }

  const artifactRows: [keyof CleanupOptions, keyof ArtifactsCard["totals"], string][] = [
    ["removeComments", "comments", t("PgnTools.Artifact.Comments")],
    ["removeNags", "nags", t("PgnTools.Artifact.Nags")],
    ["removeGlyphs", "glyphs", t("PgnTools.Artifact.Glyphs")],
    ["removeEscapes", "escapes", t("PgnTools.Artifact.Escapes")],
  ];
  const nothingSelected = !artifactRows.some(([k]) => opts[k]);
  const ok = t("PgnTools.Check.Ok");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={scope ? `${toolTitle} — ${scope.label}` : toolTitle}
      size="lg"
    >
      <Stack>
        {loading ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <>
            {mode === "export" && (
              <Alert color="blue" variant="light">
                {t("PgnTools.Export.Note")}
              </Alert>
            )}
            {mode === "export" && (
              <Paper withBorder p="sm">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600} size="sm">
                      {t("PgnTools.Export.Tags.Title")}
                    </Text>
                    <SegmentedControl
                      size="xs"
                      value={tagPreset}
                      onChange={(v) => setTagPreset(v as "standard" | "full")}
                      data={[
                        { value: "standard", label: t("PgnTools.Export.Tags.Standard") },
                        { value: "full", label: t("PgnTools.Export.Tags.Full") },
                      ]}
                    />
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t("PgnTools.Export.Tags.Hint")}
                  </Text>
                  <Checkbox
                    size="xs"
                    label={t("PgnTools.Export.NormalizeNames")}
                    description={t("PgnTools.Export.NormalizeNamesHint")}
                    checked={normalizeNames}
                    onChange={(e) => setNormalizeNames(e.currentTarget.checked)}
                  />
                  <ScrollArea.Autosize mah={200}>
                    <SimpleGrid cols={3} spacing={4} verticalSpacing={4}>
                      {displayTags.map((tag) => (
                        <Checkbox
                          key={tag}
                          size="xs"
                          label={tag}
                          checked={exportTags.has(tag)}
                          onChange={() => toggleExportTag(tag)}
                        />
                      ))}
                    </SimpleGrid>
                  </ScrollArea.Autosize>
                </Stack>
              </Paper>
            )}
            <Text size="sm" c="dimmed">
              {t("PgnTools.Check.Summary", { total: report.total })}
            </Text>
            {report.clean && report.total > 0 && (
              <Alert color="teal" variant="light">
                {t("PgnTools.Check.AllClean")}
              </Alert>
            )}

            <Accordion variant="separated" multiple>
              {/* Movetext annotations — per-class checkboxes + bulk clean. */}
              <CardShell
                status={artifacts.status}
                title={t("PgnTools.Check.Artifacts.Title")}
                detail={
                  artifacts.affected > 0
                    ? t("PgnTools.Check.Artifacts.Detail", { n: artifacts.affected })
                    : ok
                }
              >
                <Stack>
                  <Table>
                    <Table.Tbody>
                      {artifactRows.map(([optKey, countKey, label]) => (
                        <Table.Tr key={optKey}>
                          <Table.Td>
                            <Checkbox
                              label={label}
                              checked={opts[optKey]}
                              onChange={(e) =>
                                setOpts({ ...opts, [optKey]: e.currentTarget.checked })
                              }
                            />
                          </Table.Td>
                          <Table.Td ta="right">
                            <Badge
                              variant="light"
                              color={artifacts.totals[countKey] > 0 ? "orange" : "gray"}
                            >
                              {artifacts.totals[countKey]}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      loading={busy}
                      disabled={artifacts.affected === 0 || nothingSelected}
                      onClick={cleanMovetext}
                    >
                      {t("PgnTools.Check.Artifacts.Apply")}
                    </Button>
                  </Group>
                </Stack>
              </CardShell>

              {/* Variations — removed one game at a time (never in bulk). */}
              <CardShell
                status={variations.status}
                title={t("PgnTools.Check.Variations.Title")}
                detail={
                  variations.affected > 0
                    ? t("PgnTools.Check.Variations.Detail", { n: variations.affected })
                    : ok
                }
              >
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    {t("PgnTools.Check.Variations.Help")}
                  </Text>
                  <ScrollArea.Autosize mah={260}>
                    <Stack gap={4}>
                      {variations.games.map((g) => (
                        <Group key={g.index} gap="xs" wrap="nowrap" justify="space-between">
                          <Text size="xs" style={{ flex: 1 }}>
                            {refLabel(g)}
                          </Text>
                          {g.info.losesLongerLine && (
                            <Text size="xs" c="orange" style={{ whiteSpace: "nowrap" }}>
                              {t("PgnTools.Check.Variations.LosesLine", {
                                longest: g.info.longestPlies,
                                main: g.info.mainLinePlies,
                              })}
                            </Text>
                          )}
                          <Button
                            size="compact-xs"
                            variant="light"
                            loading={busy}
                            onClick={() => removeVariations(g.index, g.info)}
                          >
                            {t("PgnTools.Check.Variations.Apply")}
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Stack>
              </CardShell>

              {/* Diacritics in header tags. */}
              <CardShell
                status={diacritics.status}
                title={t("PgnTools.Check.Diacritics.Title")}
                detail={
                  diacritics.affected > 0
                    ? t("PgnTools.Check.Diacritics.Detail", { n: diacritics.affected })
                    : ok
                }
              >
                <Stack gap="xs">
                  <ScrollArea.Autosize mah={220}>
                    <Stack gap={2}>
                      {diacritics.games.map((g) => (
                        <Text key={g.index} size="xs">
                          <b>{refLabel(g)}</b>
                          {": "}
                          {g.changes.map((c) => `${c.from} → ${c.to}`).join(", ")}
                        </Text>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      loading={busy}
                      disabled={diacritics.affected === 0}
                      onClick={() => applyAll((g) => stripGameDiacritics(g))}
                    >
                      {t("PgnTools.Check.Diacritics.Apply")}
                    </Button>
                  </Group>
                </Stack>
              </CardShell>

              {/* Result header vs. movetext terminator. */}
              <CardShell
                status={result.status}
                title={t("PgnTools.Check.Result.Title")}
                detail={
                  result.affected > 0
                    ? t("PgnTools.Check.Result.Detail", { n: result.affected })
                    : ok
                }
              >
                <Stack gap="xs">
                  <ScrollArea.Autosize mah={220}>
                    <Stack gap={2}>
                      {result.games.map((g) => (
                        <Text key={g.index} size="xs">
                          <b>{refLabel(g)}</b>
                          {": "}
                          {g.header} ≠ {g.movetext ?? "—"}
                        </Text>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      loading={busy}
                      disabled={result.affected === 0}
                      onClick={() => applyAll(syncGameResult)}
                    >
                      {t("PgnTools.Check.Result.Apply")}
                    </Button>
                  </Group>
                </Stack>
              </CardShell>

              {/* Match-only: uniform Event. */}
              {event && (
                <CardShell
                  status={event.status}
                  title={t("PgnTools.Check.Event.Title")}
                  detail={
                    event.uniform
                      ? t("PgnTools.Check.Event.Uniform", { value: event.values[0] })
                      : event.values.length <= 1
                        ? t("PgnTools.Check.Event.Empty")
                        : t("PgnTools.Check.Event.Multiple", { n: event.values.length })
                  }
                >
                  <Stack gap="xs">
                    <ScrollArea.Autosize mah={160}>
                      <Stack gap={2}>
                        {event.values.map((v) => (
                          <Text key={v || "∅"} size="xs">
                            {v || t("PgnTools.Check.Tags.Empty")}
                          </Text>
                        ))}
                      </Stack>
                    </ScrollArea.Autosize>
                    <Group justify="flex-end">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => {
                          setTagKey("Event");
                          setCheckedValues(new Set());
                        }}
                      >
                        {t("PgnTools.Check.Event.OpenInTags")}
                      </Button>
                    </Group>
                  </Stack>
                </CardShell>
              )}

              {/* Match-only: team alternation across boards. */}
              {teams && (
                <CardShell
                  status={teams.status}
                  title={t("PgnTools.Check.Teams.Title")}
                  detail={
                    !teams.checkable
                      ? t("PgnTools.Check.Teams.NotCheckable")
                      : teams.violations.length === 0
                        ? t("PgnTools.Check.Teams.Ok")
                        : t("PgnTools.Check.Teams.Detail", { n: teams.violations.length })
                  }
                >
                  <Stack gap="xs">
                    {teams.teamOdd && teams.teamEven && (
                      <Text size="xs" c="dimmed">
                        {t("PgnTools.Check.Teams.Expected", {
                          odd: teams.teamOdd,
                          even: teams.teamEven,
                        })}
                      </Text>
                    )}
                    <ScrollArea.Autosize mah={200}>
                      <Stack gap={2}>
                        {teams.violations.map((g) => (
                          <Text key={g.index} size="xs">
                            {refLabel(g)}
                          </Text>
                        ))}
                      </Stack>
                    </ScrollArea.Autosize>
                    {teams.missingInfo > 0 && (
                      <Text size="xs" c="dimmed">
                        {t("PgnTools.Check.Teams.Missing", { n: teams.missingInfo })}
                      </Text>
                    )}
                  </Stack>
                </CardShell>
              )}

              {/* Tags editor — distinct values per tag + bulk unify. */}
              <CardShell
                status={tagsWarn ? "warn" : "ok"}
                title={t("PgnTools.Check.Tags.Title")}
                detail={t("PgnTools.Check.Tags.Hint")}
              >
                <Stack gap="xs">
                  <Group gap="xs" align="flex-end">
                    <Select
                      label={t("PgnTools.Check.Tags.SelectTag")}
                      data={TAG_DEFS.map((d) => d.key)}
                      value={tagKey}
                      onChange={(v) => {
                        if (v) setTagKey(v);
                        setCheckedValues(new Set());
                        setDesired("");
                      }}
                      size="xs"
                      comboboxProps={{ withinPortal: true }}
                      allowDeselect={false}
                    />
                    {!tagDef.replaceable && (
                      <Text size="xs" c="orange">
                        {t("PgnTools.Check.Tags.ListOnly")}
                      </Text>
                    )}
                  </Group>

                  <ScrollArea.Autosize mah={240}>
                    <Table verticalSpacing={2}>
                      <Table.Tbody>
                        {tagValues.map(({ value, count, suspicious }) => {
                          const minority =
                            !suspicious &&
                            tagValues.length > 1 &&
                            maxCount >= 3 &&
                            count < maxCount;
                          const color = suspicious ? "red" : minority ? "orange" : undefined;
                          return (
                            <Table.Tr key={value || "∅"}>
                              <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                  {tagDef.replaceable && (
                                    <Checkbox
                                      size="xs"
                                      checked={checkedValues.has(value)}
                                      onChange={() => toggleValue(value)}
                                    />
                                  )}
                                  <Text size="xs" c={color} fw={color ? 600 : 400}>
                                    {value || t("PgnTools.Check.Tags.Empty")}
                                  </Text>
                                </Group>
                              </Table.Td>
                              <Table.Td ta="right">
                                <Group gap="xs" justify="flex-end" wrap="nowrap">
                                  <Text size="xs" c="dimmed">
                                    {count}×
                                  </Text>
                                  {tagDef.replaceable && value !== "" && (
                                    <Button
                                      size="compact-xs"
                                      variant="subtle"
                                      onClick={() => setDesired(value)}
                                    >
                                      {t("PgnTools.Check.Tags.Take")}
                                    </Button>
                                  )}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea.Autosize>

                  {tagDef.replaceable && (
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
                        disabled={checkedValues.size === 0}
                        onClick={replaceTag}
                      >
                        {t("PgnTools.Check.Tags.Replace", { n: checkedValues.size })}
                      </Button>
                    </Group>
                  )}
                </Stack>
              </CardShell>

              {/* Duplicate pairings — informational. */}
              <CardShell
                status={duplicates.status}
                title={t("PgnTools.Check.Duplicates.Title")}
                detail={
                  duplicates.affected > 0
                    ? t("PgnTools.Check.Duplicates.Detail", { n: duplicates.affected })
                    : ok
                }
              >
                <ScrollArea.Autosize mah={220}>
                  <Stack gap="xs">
                    {duplicates.groups.map((grp) => (
                      <Stack key={grp.key} gap={0}>
                        {grp.games.map((g) => (
                          <Text key={g.index} size="xs">
                            {refLabel(g)}
                          </Text>
                        ))}
                      </Stack>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </CardShell>
            </Accordion>

            <Group justify="flex-end">
              {mode === "export" ? (
                <>
                  <Button variant="default" onClick={onClose}>
                    {t("Common.Cancel")}
                  </Button>
                  <Button loading={busy} disabled={exportTags.size === 0} onClick={saveExport}>
                    {t("PgnTools.Export.Save")}
                  </Button>
                </>
              ) : (
                <Button variant="default" onClick={onClose}>
                  {t("Common.Close")}
                </Button>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ————————————————————————————————————————————————————————————————
// Export PGN — the same Kontrola report, but fixes apply to an in-memory working
// copy that is saved to a separate .pgn (the source DB is never modified).

export function ExportPgnModal({
  opened,
  onClose,
  file,
  scope,
  matchChecks,
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
  scope?: ToolScope;
  matchChecks?: boolean;
}) {
  return (
    <KontrolaModal
      opened={opened}
      onClose={onClose}
      file={file}
      mode="export"
      scope={scope}
      matchChecks={matchChecks}
    />
  );
}

// ————————————————————————————————————————————————————————————————
// Importovat tahy — merge external games' moves into this database

function levelColor(level: 0 | 1 | 2): string {
  return level === 2 ? "teal" : level === 1 ? "orange" : "red";
}

// Static t() calls (not a dynamic key) so i18next-cli extract keeps the labels.
function levelLabel(t: (key: string) => string, level: 0 | 1 | 2): string {
  if (level === 2) return t("PgnTools.Import.LevelBoth");
  if (level === 1) return t("PgnTools.Import.LevelOne");
  return t("PgnTools.Import.LevelNone");
}

function sideLabel(s: PairSide): string {
  const rb = s.round || s.board;
  return `${s.white || "?"} – ${s.black || "?"}${rb ? ` (${rb})` : ""}`;
}

/** Recompute a game's ECO tag from its moves. A line that matches no book position
 *  (or a game with no moves at all) keeps whatever code it already carried. */
async function withEcoTag(game: string): Promise<string> {
  const eco = await getEcoFromGame(game);
  if (!eco || eco === getTag(splitGame(game).tags, "ECO")) return game;
  return setGameTag(game, "ECO", eco);
}

/** How many games are sent to the backend for ECO lookup at once — each one costs a
 *  couple of round trips and an import can be a whole tournament. */
const ECO_BATCH = 16;

/** ECO codes for a batch of games, in order, plus how many tags actually changed. */
async function withEcoTags(games: string[]): Promise<{ games: string[]; filled: number }> {
  const out: string[] = [];
  let filled = 0;
  for (let i = 0; i < games.length; i += ECO_BATCH) {
    const done = await Promise.all(games.slice(i, i + ECO_BATCH).map(withEcoTag));
    done.forEach((g, k) => {
      if (g !== games[i + k]) filled++;
      out.push(g);
    });
  }
  return { games: out, filled };
}

export function ImportGamesModal({
  opened,
  onClose,
  file,
  onChanged,
  scope,
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
  onChanged: () => void;
  /** Merge into part of the database only — typically the match the captain sent. */
  scope?: ToolScope;
}) {
  const { t } = useTranslation();
  const [allGames, setAllGames] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [imported, setImported] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  // assignment[t] = index into `imported` paired with target t, or null.
  const [assignment, setAssignment] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  // Where the imported games came from ("3 files"), and whether a drag is over us.
  const [sourceLabel, setSourceLabel] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setImported([]);
    setPasted("");
    setAssignment([]);
    setSourceLabel("");
    setDragOver(false);
    readAllGames(file).then((all) => {
      setAllGames(all);
      setTargets(pickScoped(all, scope));
    });
  }, [opened, file, scope]);

  // Dropping files on the window: with Tauri's own drag-drop enabled (the default),
  // the webview never sees an HTML5 drop — the paths arrive as an event instead.
  // The handler goes through a ref because it closes over `targets`, which is still
  // empty on the render that registers the listener.
  const dropHandler = useRef<(paths: string[]) => void>(() => {});
  useEffect(() => {
    if (!opened) return;
    // Claim first: the app-wide handler would otherwise open the same files as new
    // databases behind this dialog.
    const release = claimFileDrop();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragOver(true);
          else if (event.payload.type === "drop") {
            setDragOver(false);
            dropHandler.current(event.payload.paths);
          } else setDragOver(false);
        })
        .then((fn) => (cancelled ? fn() : (unlisten = fn)))
        .catch(() => {});
    } catch {
      // No webview (tests, browser preview). Picking and pasting still work.
    }
    return () => {
      cancelled = true;
      release();
      unlisten?.();
    };
  }, [opened]);

  const targetSides = useMemo(
    () => targets.map((g) => pairSideFromTags(splitGame(g).tags)),
    [targets],
  );
  const importedSides = useMemo(
    () => imported.map((g) => pairSideFromTags(splitGame(g).tags)),
    [imported],
  );

  function loadImported(text: string) {
    const parsed = splitPgnGames(text);
    setImported(parsed);
    // Seed the assignment with the automatic best-first pairing; the user can then
    // adjust any row by hand.
    setAssignment(parsed.length > 0 ? planMerge(targets, parsed).rows.map((r) => r.imported) : []);
  }

  // Assign imported game `j` (or null) to target `t`, keeping the mapping 1:1 by
  // releasing `j` from whichever other target held it.
  function assign(t2: number, j: number | null) {
    setAssignment((prev) => {
      const next = [...prev];
      if (j != null) for (let k = 0; k < next.length; k++) if (next[k] === j) next[k] = null;
      next[t2] = j;
      return next;
    });
  }

  const usedImported = new Set(assignment.filter((j): j is number => j != null));
  const leftovers = importedSides.map((_, j) => j).filter((j) => !usedImported.has(j));
  const matchedCount = usedImported.size;

  async function apply() {
    setBusy(true);
    try {
      const mergedInto: number[] = [];
      const merged = targets.map((g, t2) => {
        const j = assignment[t2];
        if (j == null) return g;
        mergedInto.push(t2);
        return applyMergedMovetext(g, imported[j]);
      });
      const appended = leftovers.map((j) => imported[j]);

      // The moves are new, so the ECO code is derived from them — for the games that
      // just received movetext and for the imports appended whole.
      const eco = await withEcoTags([...mergedInto.map((t2) => merged[t2]), ...appended]);
      mergedInto.forEach((t2, k) => {
        merged[t2] = eco.games[k];
      });
      const appendedWithEco = eco.games.slice(mergedInto.length);

      // Unmatched imports are appended to the file, never inserted into the scope.
      const next = [...spliceScoped(allGames, scope, merged), ...appendedWithEco];
      await writeTextFile(file.path, next.join("\n\n\n") + "\n");
      const done = t("PgnTools.Import.Done", { matched: matchedCount, appended: appended.length });
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: eco.filled
          ? `${done} ${t("PgnTools.Import.DoneEco", { count: eco.filled })}`
          : done,
        color: "teal",
      });
      onChanged();
      onClose();
    } catch (e) {
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  /** Read every path and treat the lot as one stream of games — a captain who sends
   *  eight single-game files is the normal case, not an edge one. */
  async function loadFiles(paths: string[]) {
    const pgns = paths.filter((p) => /\.pgn$/i.test(p));
    if (pgns.length === 0) {
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: t("PgnTools.Import.NoPgnFiles"),
        color: "orange",
      });
      return;
    }
    try {
      const texts = await Promise.all(pgns.map((p) => readTextFile(p)));
      loadImported(texts.join("\n\n\n"));
      setSourceLabel(t("PgnTools.Import.Loaded", { count: pgns.length }));
    } catch (e) {
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: String(e),
        color: "red",
      });
    }
  }

  async function pickFile() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!selected) return;
    await loadFiles(Array.isArray(selected) ? selected : [selected]);
  }

  // Keep the drop listener pointed at the current closure (see the effect above).
  useEffect(() => {
    dropHandler.current = (paths) => void loadFiles(paths);
  });

  const importedOptions = importedSides.map((s, j) => ({ value: String(j), label: sideLabel(s) }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={scope ? `${t("PgnTools.Import.Title")} — ${scope.label}` : t("PgnTools.Import.Title")}
      size="xl"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t("PgnTools.Import.Help")}
        </Text>
        <Paper
          withBorder
          p="md"
          style={{
            borderStyle: "dashed",
            borderColor: dragOver ? "var(--mantine-color-blue-5)" : undefined,
            backgroundColor: dragOver ? "var(--mantine-color-blue-light)" : undefined,
          }}
        >
          <Group justify="center" gap="sm">
            <IconFileImport size="1.2rem" opacity={0.6} />
            <Text size="sm" c="dimmed">
              {t("PgnTools.Import.DropHint")}
            </Text>
            <Button variant="default" size="xs" onClick={pickFile}>
              {t("PgnTools.Import.PickFile")}
            </Button>
          </Group>
          {sourceLabel && (
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              {sourceLabel}
            </Text>
          )}
        </Paper>
        <Textarea
          placeholder={t("PgnTools.Import.PastePlaceholder")}
          value={pasted}
          onChange={(e) => {
            setPasted(e.currentTarget.value);
            loadImported(e.currentTarget.value);
          }}
          autosize
          minRows={3}
          maxRows={6}
        />

        {imported.length > 0 && (
          <>
            <ScrollArea.Autosize mah={360}>
              <Table stickyHeader verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("PgnTools.Import.TargetGame")}</Table.Th>
                    <Table.Th>{t("PgnTools.Import.ImportedGame")}</Table.Th>
                    <Table.Th>{t("PgnTools.Import.Match")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {targetSides.map((targetSide, t2) => {
                    const j = assignment[t2];
                    const level = j != null ? matchLevel(targetSide, importedSides[j]) : null;
                    return (
                      <Table.Tr key={t2}>
                        <Table.Td>{sideLabel(targetSide)}</Table.Td>
                        <Table.Td>
                          <Select
                            data={importedOptions}
                            value={j != null ? String(j) : null}
                            onChange={(v) => assign(t2, v == null ? null : Number(v))}
                            placeholder={t("PgnTools.Import.Unassigned")}
                            clearable
                            searchable
                            size="xs"
                            comboboxProps={{ withinPortal: true }}
                          />
                        </Table.Td>
                        <Table.Td>
                          {level != null ? (
                            <Badge color={levelColor(level)} variant="light">
                              {levelLabel(t, level)}
                            </Badge>
                          ) : (
                            <Badge color="gray" variant="light">
                              {t("PgnTools.Import.NoMatch")}
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>

            <Group gap="lg">
              <Text size="xs" c="dimmed">
                {t("PgnTools.Import.Legend")}
              </Text>
            </Group>
            {leftovers.length > 0 && (
              <Text size="sm" c="dimmed">
                {t("PgnTools.Import.WillAppend", { count: leftovers.length })}
              </Text>
            )}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={imported.length === 0} onClick={apply}>
            {t("PgnTools.Import.Apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

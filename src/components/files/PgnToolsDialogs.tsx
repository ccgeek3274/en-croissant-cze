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
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconMinus } from "@tabler/icons-react";
import { confirm as confirmDialog, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
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
import { type CleanupOptions, FULL_CLEANUP } from "@/utils/pgn/cleanup";
import { buildExportGame } from "@/utils/pgn/export";
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
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
  /** Called after an in-place edit rewrites the source DB (ignored in export mode). */
  onChanged?: () => void;
  /** "inplace" writes fixes back to the source DB (Kontrola); "export" applies them
   *  to an in-memory working copy that is finally saved to a separate .pgn file. */
  mode?: "inplace" | "export";
}) {
  const { t } = useTranslation();
  const isMatch = file.metadata.type === "tournament";
  const toolTitle = mode === "export" ? t("PgnTools.Export.Title") : t("PgnTools.Kontrola.Title");
  const [games, setGames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Movetext cleanup toggles (variations are handled per-game, so not here).
  const [opts, setOpts] = useState<CleanupOptions>(FULL_CLEANUP);
  // "Tagy" editor state.
  const [tagKey, setTagKey] = useState<string>("Event");
  const [checkedValues, setCheckedValues] = useState<Set<string>>(new Set());
  const [desired, setDesired] = useState("");

  async function reload() {
    setLoading(true);
    try {
      setGames(await readAllGames(file));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, file]);

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

  // Apply `next`: in-place mode rewrites the source DB and re-checks; export mode
  // only updates the in-memory working copy (the source DB stays untouched — the
  // result is written out later by saveExport).
  async function commit(next: string[], msg?: string) {
    setBusy(true);
    try {
      if (mode === "export") {
        setGames(next);
      } else {
        await writeTextFile(file.path, next.join("\n\n\n") + "\n");
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
      await writeTextFile(dest, games.join("\n\n\n") + "\n");
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
    <Modal opened={opened} onClose={onClose} title={toolTitle} size="lg">
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
                  <Button loading={busy} onClick={saveExport}>
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
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
}) {
  return <KontrolaModal opened={opened} onClose={onClose} file={file} mode="export" />;
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

export function ImportGamesModal({
  opened,
  onClose,
  file,
  onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<string[]>([]);
  const [imported, setImported] = useState<string[]>([]);
  const [pasted, setPasted] = useState("");
  // assignment[t] = index into `imported` paired with target t, or null.
  const [assignment, setAssignment] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setImported([]);
    setPasted("");
    setAssignment([]);
    readAllGames(file).then(setTargets);
  }, [opened, file]);

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
      const merged = targets.map((g, t2) => {
        const j = assignment[t2];
        return j != null ? applyMergedMovetext(g, imported[j]) : g;
      });
      const appended = leftovers.map((j) => imported[j]);
      await writeTextFile(file.path, [...merged, ...appended].join("\n\n\n") + "\n");
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: t("PgnTools.Import.Done", { matched: matchedCount, appended: appended.length }),
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

  async function pickFile() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    loadImported(await readTextFile(selected));
  }

  const importedOptions = importedSides.map((s, j) => ({ value: String(j), label: sideLabel(s) }));

  return (
    <Modal opened={opened} onClose={onClose} title={t("PgnTools.Import.Title")} size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("PgnTools.Import.Help")}
        </Text>
        <Group>
          <Button variant="default" onClick={pickFile}>
            {t("PgnTools.Import.PickFile")}
          </Button>
        </Group>
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

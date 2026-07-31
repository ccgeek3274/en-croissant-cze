// Database-agnostic PGN tools exposed on a file: Kontrola (validate + clean),
// Export PGN (pgn-base-style options), Importovat partie (merge external games).
// They operate on the on-disk .pgn via the Rust read/write commands and the pure
// helpers in src/utils/pgn, so they work on any database, not just ŠSČR imports.

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import {
  type ArtifactCounts,
  type CleanupOptions,
  countArtifacts,
  FULL_CLEANUP,
  hasArtifacts,
} from "@/utils/pgn/cleanup";
import {
  buildExportGame,
  buildExportPgn,
  type ExportOptions,
  type HeaderMode,
} from "@/utils/pgn/export";
import { applyMergedMovetext, type MergePlan, planMerge } from "@/utils/pgn/merge";
import { splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { unwrap } from "@/utils/unwrap";
import type { FileMetadata } from "./file";

async function readAllGames(file: FileMetadata): Promise<string[]> {
  if (file.numGames <= 0) return [];
  return unwrap(await commands.readGames(file.path, 0, file.numGames - 1));
}

// ————————————————————————————————————————————————————————————————
// Kontrola — validate & clean

function emptyCounts(): ArtifactCounts {
  return { comments: 0, variations: 0, nags: 0, glyphs: 0, escapes: 0 };
}

function sumCounts(games: string[]): { totals: ArtifactCounts; affected: number } {
  const totals = emptyCounts();
  let affected = 0;
  for (const g of games) {
    const c = countArtifacts(splitGame(g).movetext);
    totals.comments += c.comments;
    totals.variations += c.variations;
    totals.nags += c.nags;
    totals.glyphs += c.glyphs;
    totals.escapes += c.escapes;
    if (hasArtifacts(c)) affected++;
  }
  return { totals, affected };
}

export function KontrolaModal({
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
  const [games, setGames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<CleanupOptions>(FULL_CLEANUP);

  useEffect(() => {
    if (!opened) return;
    setLoading(true);
    readAllGames(file)
      .then(setGames)
      .finally(() => setLoading(false));
  }, [opened, file]);

  const { totals, affected } = sumCounts(games);
  const anything = hasArtifacts(totals);

  async function clean() {
    setBusy(true);
    try {
      const cleaned = games.map((g) =>
        buildExportGame(g, { headers: "all", cleanup: opts, stripDiacritics: false }),
      );
      await writeTextFile(file.path, cleaned.join("\n\n\n") + "\n");
      notifications.show({
        title: t("PgnTools.Kontrola.Title"),
        message: t("PgnTools.Kontrola.Cleaned", { count: affected }),
        color: "teal",
      });
      onChanged();
      onClose();
    } catch (e) {
      notifications.show({
        title: t("PgnTools.Kontrola.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  const rows: [keyof CleanupOptions, keyof ArtifactCounts, string][] = [
    ["removeComments", "comments", t("PgnTools.Artifact.Comments")],
    ["removeVariations", "variations", t("PgnTools.Artifact.Variations")],
    ["removeNags", "nags", t("PgnTools.Artifact.Nags")],
    ["removeGlyphs", "glyphs", t("PgnTools.Artifact.Glyphs")],
    ["removeEscapes", "escapes", t("PgnTools.Artifact.Escapes")],
  ];

  return (
    <Modal opened={opened} onClose={onClose} title={t("PgnTools.Kontrola.Title")} size="md">
      <Stack>
        {loading ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t("PgnTools.Kontrola.Summary", {
                total: games.length,
                affected,
              })}
            </Text>
            <Table>
              <Table.Tbody>
                {rows.map(([optKey, countKey, label]) => (
                  <Table.Tr key={optKey}>
                    <Table.Td>
                      <Checkbox
                        label={label}
                        checked={opts[optKey]}
                        onChange={(e) => setOpts({ ...opts, [optKey]: e.currentTarget.checked })}
                      />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Badge variant="light" color={totals[countKey] > 0 ? "orange" : "gray"}>
                        {totals[countKey]}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!anything && (
              <Alert color="teal" variant="light">
                {t("PgnTools.Kontrola.Clean")}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                {t("Common.Cancel")}
              </Button>
              <Button loading={busy} disabled={!anything} onClick={clean}>
                {t("PgnTools.Kontrola.Apply")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ————————————————————————————————————————————————————————————————
// Export PGN

export function ExportPgnModal({
  opened,
  onClose,
  file,
}: {
  opened: boolean;
  onClose: () => void;
  file: FileMetadata;
}) {
  const { t } = useTranslation();
  const [headers, setHeaders] = useState<HeaderMode>("all");
  const [clean, setClean] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupOptions>(FULL_CLEANUP);
  const [stripDiacritics, setStripDiacritics] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doExport() {
    const dest = await save({
      defaultPath: `${file.name}.pgn`,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const games = await readAllGames(file);
      const opts: ExportOptions = {
        headers,
        cleanup: clean ? cleanup : null,
        stripDiacritics,
      };
      await writeTextFile(dest, buildExportPgn(games, opts));
      notifications.show({
        title: t("PgnTools.Export.Title"),
        message: t("PgnTools.Export.Done", { count: games.length }),
        color: "teal",
      });
      onClose();
    } catch (e) {
      notifications.show({
        title: t("PgnTools.Export.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  const cleanupRows: [keyof CleanupOptions, string][] = [
    ["removeComments", t("PgnTools.Artifact.Comments")],
    ["removeVariations", t("PgnTools.Artifact.Variations")],
    ["removeNags", t("PgnTools.Artifact.Nags")],
    ["removeGlyphs", t("PgnTools.Artifact.Glyphs")],
    ["removeEscapes", t("PgnTools.Artifact.Escapes")],
  ];

  return (
    <Modal opened={opened} onClose={onClose} title={t("PgnTools.Export.Title")} size="md">
      <Stack>
        <div>
          <Text size="sm" fw={600} mb={4}>
            {t("PgnTools.Export.Headers")}
          </Text>
          <SegmentedControl
            fullWidth
            value={headers}
            onChange={(v) => setHeaders(v as HeaderMode)}
            data={[
              { value: "all", label: t("PgnTools.Export.HeadersAll") },
              { value: "standard", label: t("PgnTools.Export.HeadersStandard") },
            ]}
          />
        </div>

        <div>
          <Checkbox
            label={t("PgnTools.Export.CleanMovetext")}
            checked={clean}
            onChange={(e) => setClean(e.currentTarget.checked)}
          />
          {clean && (
            <Stack gap={4} mt="xs" ml="lg">
              {cleanupRows.map(([key, label]) => (
                <Checkbox
                  key={key}
                  size="xs"
                  label={label}
                  checked={cleanup[key]}
                  onChange={(e) => setCleanup({ ...cleanup, [key]: e.currentTarget.checked })}
                />
              ))}
            </Stack>
          )}
        </div>

        <Checkbox
          label={t("PgnTools.Export.StripDiacritics")}
          checked={stripDiacritics}
          onChange={(e) => setStripDiacritics(e.currentTarget.checked)}
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} onClick={doExport}>
            {t("PgnTools.Export.Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ————————————————————————————————————————————————————————————————
// Importovat partie — merge external games into this database

function levelColor(level: 0 | 1 | 2): string {
  return level === 2 ? "teal" : level === 1 ? "orange" : "red";
}

function sideLabel(s: { white: string; black: string }): string {
  return `${s.white || "?"} – ${s.black || "?"}`;
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
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setImported([]);
    setPasted("");
    setPlan(null);
    readAllGames(file).then(setTargets);
  }, [opened, file]);

  function loadImported(text: string) {
    const parsed = splitPgnGames(text);
    setImported(parsed);
    setPlan(parsed.length > 0 ? planMerge(targets, parsed) : null);
  }

  async function pickFile() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    loadImported(await readTextFile(selected));
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    try {
      const merged = targets.map((g, t2) => {
        const row = plan.rows[t2];
        return row.imported != null ? applyMergedMovetext(g, imported[row.imported]) : g;
      });
      const appended = plan.appendedImported.map((j) => imported[j]);
      const all = [...merged, ...appended];
      await writeTextFile(file.path, all.join("\n\n\n") + "\n");
      notifications.show({
        title: t("PgnTools.Import.Title"),
        message: t("PgnTools.Import.Done", {
          matched: plan.rows.filter((r) => r.imported != null).length,
          appended: appended.length,
        }),
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

        {plan && (
          <ScrollArea.Autosize mah={320}>
            <Table stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("PgnTools.Import.TargetGame")}</Table.Th>
                  <Table.Th>{t("PgnTools.Import.ImportedGame")}</Table.Th>
                  <Table.Th>{t("PgnTools.Import.Match")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {plan.rows.map((row) => (
                  <Table.Tr key={row.target}>
                    <Table.Td>{sideLabel(row.targetSide)}</Table.Td>
                    <Table.Td>{row.importedSide ? sideLabel(row.importedSide) : "—"}</Table.Td>
                    <Table.Td>
                      {row.imported != null ? (
                        <Badge color={levelColor(row.level)} variant="light">
                          {t(`PgnTools.Import.Level${row.level}`)}
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light">
                          {t("PgnTools.Import.NoMatch")}
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {plan.appendedImported.length > 0 && (
              <Text size="sm" c="dimmed" mt="xs">
                {t("PgnTools.Import.WillAppend", {
                  count: plan.appendedImported.length,
                })}
              </Text>
            )}
          </ScrollArea.Autosize>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={!plan || imported.length === 0} onClick={apply}>
            {t("PgnTools.Import.Apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

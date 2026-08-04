// The ŠSČR deliverable: the short-label directory the Event tag is built from, and
// the export itself.
//
// The export is what goes on the competition website, so it is preflighted rather
// than just produced — a match nobody sent moves for looks like eight empty games
// in the bulletin and is easy to miss. Nothing blocks: a leader sometimes has to
// publish an incomplete round on purpose.

import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deriveDirectory,
  labelMapFrom,
  resolveDirectory,
  siteMapFrom,
} from "@/utils/sscr/directory";
import {
  buildSscrExport,
  DEFAULT_EXPORT_OPTIONS,
  defaultEventPrefix,
  exportPreflight,
  type SscrExportOptions,
} from "@/utils/sscr/export";
import type { CompetitionManifest } from "@/utils/sscr/manifest";
import { loadCompetition, saveCompetition } from "@/utils/sscr/storage";

// ── Zkratky soutěže ─────────────────────────────────────────────────────────

export function CompetitionLabelsDialog({
  opened,
  onClose,
  pgnPath,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  pgnPath: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [manifest, setManifest] = useState<CompetitionManifest | null>(null);
  const [prefix, setPrefix] = useState("");
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [sites, setSites] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    loadCompetition(pgnPath).then((loaded) => {
      if (cancelled || !loaded) return;
      const m = loaded.manifest;
      setManifest(m);
      setPrefix(
        m.options.eventPrefix ?? defaultEventPrefix(m.competition.name, m.competition.year),
      );
      // Resolved, not stored: a competition imported before the directory existed has
      // nothing on file, and the leader should still see what the export will write.
      const resolved = resolveDirectory(m);
      setLabels(Object.fromEntries(resolved.map((team) => [team.no, team.label])));
      setSites(Object.fromEntries(resolved.map((team) => [team.no, team.site])));
    });
    return () => {
      cancelled = true;
    };
  }, [opened, pgnPath]);

  /** Fill every field the leader emptied back in from the bundled club dictionary. */
  function suggest() {
    if (!manifest) return;
    const derived = deriveDirectory(manifest.teams);
    setLabels((prev) => {
      const next = { ...prev };
      for (const team of manifest.teams) {
        if (!next[team.no]) next[team.no] = derived.get(team.no)?.label ?? "";
      }
      return next;
    });
    setSites((prev) => {
      const next = { ...prev };
      for (const team of manifest.teams) {
        if (!next[team.no]) next[team.no] = derived.get(team.no)?.site ?? "";
      }
      return next;
    });
  }

  async function apply() {
    if (!manifest) return;
    setBusy(true);
    try {
      const loaded = await loadCompetition(pgnPath);
      if (!loaded) throw new Error(t("Competition.NotACompetition"));
      const next: CompetitionManifest = {
        ...loaded.manifest,
        teams: loaded.manifest.teams.map((team) => ({
          ...team,
          label: labels[team.no]?.trim() || null,
          site: sites[team.no]?.trim() || null,
        })),
        options: { ...loaded.manifest.options, eventPrefix: prefix.trim() || null },
      };
      await saveCompetition(pgnPath, next, loaded.games);
      notifications.show({
        title: t("Competition.Labels.Title"),
        message: t("Competition.Labels.Saved"),
        color: "teal",
      });
      onSaved();
      onClose();
    } catch (e) {
      notifications.show({
        title: t("Competition.Labels.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Competition.Labels.Title")} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Competition.Labels.Help")}
        </Text>
        <TextInput
          label={t("Competition.Labels.Prefix")}
          description={t("Competition.Labels.PrefixHelp")}
          value={prefix}
          onChange={(e) => setPrefix(e.currentTarget.value)}
        />
        <Group justify="space-between">
          <Text fw={600} size="sm">
            {t("Competition.Labels.Teams")}
          </Text>
          <Button size="compact-xs" variant="default" onClick={suggest}>
            {t("Competition.Labels.Suggest")}
          </Button>
        </Group>
        <ScrollArea.Autosize mah={360}>
          <Table verticalSpacing={2}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Competition.Labels.TeamName")}</Table.Th>
                <Table.Th w={160}>{t("Competition.Labels.Label")}</Table.Th>
                <Table.Th w={160}>{t("Competition.Labels.Site")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(manifest?.teams ?? []).map((team) => (
                <Table.Tr key={team.no}>
                  <Table.Td>
                    <Text size="xs">{team.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      aria-label={`${t("Competition.Labels.Label")} — ${team.name}`}
                      value={labels[team.no] ?? ""}
                      onChange={(e) =>
                        setLabels((prev) => ({ ...prev, [team.no]: e.currentTarget.value }))
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      aria-label={`${t("Competition.Labels.Site")} — ${team.name}`}
                      value={sites[team.no] ?? ""}
                      onChange={(e) =>
                        setSites((prev) => ({ ...prev, [team.no]: e.currentTarget.value }))
                      }
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={!manifest} onClick={apply}>
            {t("Competition.Labels.Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Export ŠSČR ─────────────────────────────────────────────────────────────

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="xs" c={warn ? "orange" : "dimmed"}>
        {label}
      </Text>
      <Text size="xs" fw={600} c={warn ? "orange" : undefined}>
        {value}
      </Text>
    </Group>
  );
}

export function SscrExportModal({
  opened,
  onClose,
  pgnPath,
  /** Game indices to export; omit for the whole file. */
  indices,
  scopeLabel,
  defaultFileName,
}: {
  opened: boolean;
  onClose: () => void;
  pgnPath: string;
  indices?: number[];
  scopeLabel: string;
  defaultFileName: string;
}) {
  const { t } = useTranslation();
  const [games, setGames] = useState<string[]>([]);
  const [manifest, setManifest] = useState<CompetitionManifest | null>(null);
  const [dropEmptyForfeits, setDropEmptyForfeits] = useState(
    DEFAULT_EXPORT_OPTIONS.dropEmptyForfeits,
  );
  const [stripDiacritics, setStripDiacritics] = useState(DEFAULT_EXPORT_OPTIONS.stripDiacritics);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    loadCompetition(pgnPath).then((loaded) => {
      if (cancelled || !loaded) return;
      setManifest(loaded.manifest);
      setGames(indices ? indices.map((i) => loaded.games[i]).filter(Boolean) : loaded.games);
    });
    return () => {
      cancelled = true;
    };
  }, [opened, pgnPath, indices]);

  const options: SscrExportOptions | null = useMemo(() => {
    if (!manifest) return null;
    return {
      prefix:
        manifest.options.eventPrefix ??
        defaultEventPrefix(manifest.competition.name, manifest.competition.year),
      labelByTeamName: labelMapFrom(manifest),
      siteByTeamName: siteMapFrom(manifest),
      dropEmptyForfeits,
      stripDiacritics,
    };
  }, [manifest, dropEmptyForfeits, stripDiacritics]);

  const report = useMemo(
    () => (options ? exportPreflight(games, options) : null),
    [games, options],
  );

  async function saveExport() {
    if (!options) return;
    const dest = await save({
      defaultPath: `${defaultFileName}.pgn`,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const result = buildSscrExport(games, options);
      await writeTextFile(dest, result.pgn);
      notifications.show({
        title: t("Competition.Export.Title"),
        message: t("Competition.Export.Done", { count: result.included }),
        color: "teal",
      });
      onClose();
    } catch (e) {
      notifications.show({
        title: t("Competition.Export.Title"),
        message: String(e),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${t("Competition.Export.Title")} — ${scopeLabel}`}
      size="lg"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Competition.Export.Help")}
        </Text>

        {options && (
          <Paper withBorder p="sm">
            <Stack gap={4}>
              <Row label={t("Competition.Labels.Prefix")} value={options.prefix || "—"} />
              <Row
                label={t("Competition.Export.SampleEvent")}
                value={`${options.prefix} A-B`.trim()}
              />
            </Stack>
          </Paper>
        )}

        <SimpleGrid cols={2}>
          <Checkbox
            size="xs"
            label={t("Competition.Export.DropForfeits")}
            checked={dropEmptyForfeits}
            onChange={(e) => setDropEmptyForfeits(e.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label={t("Competition.Export.StripDiacritics")}
            checked={stripDiacritics}
            onChange={(e) => setStripDiacritics(e.currentTarget.checked)}
          />
        </SimpleGrid>

        {report && (
          <Paper withBorder p="sm">
            <Stack gap={4}>
              <Row label={t("Competition.Export.WillExport")} value={report.total} />
              <Row
                label={t("Competition.Export.WithoutMoves")}
                value={report.withoutMoves}
                warn={report.withoutMoves > 0}
              />
              <Row
                label={t("Competition.Export.WithoutResult")}
                value={report.withoutResult}
                warn={report.withoutResult > 0}
              />
              <Row
                label={t("Competition.Export.Placeholders")}
                value={report.placeholderNames}
                warn={report.placeholderNames > 0}
              />
              <Row label={t("Competition.Export.Dropped")} value={report.droppedForfeits} />
            </Stack>
          </Paper>
        )}

        {report && report.matchesWithoutMoves.length > 0 && (
          <Alert color="orange" variant="light">
            {t("Competition.Export.MatchesWithoutMoves", {
              n: report.matchesWithoutMoves.length,
              list: report.matchesWithoutMoves.slice(0, 12).join(", "),
            })}
          </Alert>
        )}
        {report && report.unlabelledTeams.length > 0 && (
          <Alert color="orange" variant="light">
            {t("Competition.Export.Unlabelled", { list: report.unlabelledTeams.join(", ") })}
          </Alert>
        )}
        {report && report.duplicateEvents.length > 0 && (
          <Alert color="red" variant="light">
            {t("Competition.Export.DuplicateEvents", { list: report.duplicateEvents.join(", ") })}
          </Alert>
        )}
        {report?.clean && (
          <Alert color="teal" variant="light">
            {t("Competition.Export.Clean")}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={!report || report.total === 0} onClick={saveExport}>
            {t("Competition.Export.Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

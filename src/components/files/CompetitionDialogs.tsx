// Creating a competition from a Swiss-Manager XML, and re-syncing it against a
// newer export once a round has been played.
//
// Both dialogs are report-first: the leader sees exactly what the file says (and
// what is wrong with it) before anything is written. Re-sync never overwrites a
// game that already carries a captain's moves without being told to.

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { basename } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { sanitizeFilename } from "@/utils/filename";
import type { ParseIssue } from "@/utils/sscr/competitionXml";
import { roundFillState } from "@/utils/sscr/competitionXml";
import type { EloSource } from "@/utils/sscr/skeleton";
import {
  applyResync,
  createCompetition,
  type ImportPreview,
  loadCompetition,
  previewImport,
  previewResync,
  type ResyncPreview,
} from "@/utils/sscr/storage";
import type { SyncRow, SyncRowKind } from "@/utils/sscr/sync";

type PickedXml = { fileName: string; xml: string };

/** Pick an XML from disk and return its name + contents. */
async function pickXml(): Promise<PickedXml | null> {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: "XML", extensions: ["xml", "XML"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return { fileName: await basename(selected), xml: await readTextFile(selected) };
}

function hasCompetition<T extends object>(v: T | { issues: ParseIssue[] }): v is T {
  return "competition" in v;
}

// ── shared bits ─────────────────────────────────────────────────────────────

function IssueList({ issues }: { issues: ParseIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  const worst = issues.some((i) => i.level === "error")
    ? "red"
    : issues.some((i) => i.level === "warn")
      ? "orange"
      : "blue";
  return (
    <Alert
      color={worst}
      variant="light"
      icon={worst === "blue" ? <IconInfoCircle size="1rem" /> : <IconAlertTriangle size="1rem" />}
      title={t("Competition.Issues")}
    >
      <ScrollArea.Autosize mah={140}>
        <Stack gap={2}>
          {issues.map((issue) => (
            <Text key={`${issue.code}|${issue.detail}`} size="xs">
              {/* Dynamic key — kept alive by the Competition.Issue.* preserve pattern. */}
              {t(`Competition.Issue.${issue.code}`, { defaultValue: issue.code })}
              {issue.detail && `: ${issue.detail}`}
            </Text>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Alert>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </Stack>
  );
}

// ── Nová soutěž z XML ───────────────────────────────────────────────────────

export function CompetitionImportModal({
  opened,
  onClose,
  dir,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  /** Directory the competition is created in. */
  dir: string;
  onCreated: (pgnPath: string) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<PickedXml | null>(null);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [eloSource, setEloSource] = useState<EloSource>("fide");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setPicked(null);
    setIssues([]);
    setPreview(null);
    setName("");
    setError("");
  }, []);

  function close() {
    reset();
    onClose();
  }

  async function choose() {
    setError("");
    const file = await pickXml();
    if (!file) return;
    const result = previewImport(file.xml, { eloSource });
    setPicked(file);
    setIssues(result.issues);
    if (hasCompetition(result)) {
      setPreview(result);
      setName(sanitizeFilename(result.competition.info.name));
    } else {
      setPreview(null);
    }
  }

  // Switching the rating source only changes the skeleton, not the parse.
  function changeElo(next: EloSource) {
    setEloSource(next);
    if (!picked) return;
    const result = previewImport(picked.xml, { eloSource: next });
    if (hasCompetition(result)) setPreview(result);
  }

  async function create() {
    if (!preview || !picked) return;
    setBusy(true);
    setError("");
    try {
      const created = await createCompetition({
        dir,
        name,
        sourceFileName: picked.fileName,
        xml: picked.xml,
        competition: preview.competition,
        eloSource,
      });
      notifications.show({
        title: t("Competition.Import.Title"),
        message: t("Competition.Import.Created", { count: created.gameCount }),
        color: "teal",
      });
      onCreated(created.pgnPath);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rounds = preview?.competition.rounds ?? [];

  return (
    <Modal opened={opened} onClose={close} title={t("Competition.Import.Title")} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Competition.Import.Help")}
        </Text>
        <Group>
          <Button variant="default" onClick={choose}>
            {t("Competition.PickXml")}
          </Button>
          {picked && (
            <Text size="sm" c="dimmed">
              {picked.fileName}
            </Text>
          )}
        </Group>

        <IssueList issues={issues} />

        {preview && (
          <>
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Text fw={600}>{preview.competition.info.name}</Text>
                <SimpleGrid cols={4}>
                  <Stat label={t("Competition.Teams")} value={preview.competition.teams.length} />
                  <Stat label={t("Competition.Rounds")} value={rounds.length} />
                  <Stat
                    label={t("Competition.Boards")}
                    value={preview.competition.info.boardCount}
                  />
                  <Stat label={t("Competition.Games")} value={preview.skeleton.length} />
                </SimpleGrid>
              </Stack>
            </Paper>

            <ScrollArea.Autosize mah={200}>
              <Table verticalSpacing={2}>
                <Table.Tbody>
                  {rounds.map((round) => {
                    const state = roundFillState(round);
                    return (
                      <Table.Tr key={round.roundNr}>
                        <Table.Td>
                          <Text size="xs">
                            {t("Competition.RoundNr", { n: round.roundNr })} · {round.date}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Badge
                            size="xs"
                            variant="light"
                            color={
                              state === "complete"
                                ? "teal"
                                : state === "partial"
                                  ? "orange"
                                  : "gray"
                            }
                          >
                            {/* Static t() calls so extraction sees all three. */}
                            {state === "complete"
                              ? t("Competition.Round.Complete")
                              : state === "partial"
                                ? t("Competition.Round.Partial")
                                : t("Competition.Round.Empty")}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>

            <Group align="flex-end" gap="sm">
              <TextInput
                style={{ flex: 1 }}
                label={t("Competition.Import.Name")}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                error={error || undefined}
              />
              <Stack gap={2}>
                <Text size="xs" fw={500}>
                  {t("Competition.EloSource")}
                </Text>
                <SegmentedControl
                  size="xs"
                  value={eloSource}
                  onChange={(v) => changeElo(v as EloSource)}
                  data={[
                    { value: "fide", label: t("Competition.EloFide") },
                    { value: "cze", label: t("Competition.EloCze") },
                  ]}
                />
              </Stack>
            </Group>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={!preview || !name.trim()} onClick={create}>
            {t("Competition.Import.Create")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Aktualizovat z XML (re-sync) ────────────────────────────────────────────

const KIND_COLOR: Record<SyncRowKind, string> = {
  unchanged: "gray",
  added: "blue",
  fill: "teal",
  update: "cyan",
  conflict: "orange",
};

// Static t() per kind (not a dynamic key) so i18next-cli extract keeps the labels.
function kindLabel(t: (key: string) => string, kind: SyncRowKind): string {
  if (kind === "added") return t("Competition.Sync.Added");
  if (kind === "fill") return t("Competition.Sync.Fill");
  if (kind === "update") return t("Competition.Sync.Update");
  if (kind === "conflict") return t("Competition.Sync.Conflict");
  return t("Competition.Sync.Unchanged");
}

function ChangeSummary({ row }: { row: SyncRow }) {
  return (
    <Stack gap={0}>
      {row.changes.map((c) => (
        <Text key={c.tag} size="xs" c="dimmed">
          {c.tag}: {c.from || "—"} → {c.to || "—"}
        </Text>
      ))}
    </Stack>
  );
}

export function CompetitionResyncModal({
  opened,
  onClose,
  pgnPath,
  onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  pgnPath: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<PickedXml | null>(null);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [preview, setPreview] = useState<ResyncPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setPicked(null);
    setIssues([]);
    setPreview(null);
    setAccepted(new Set());
    setError("");
    onClose();
  }

  async function choose() {
    setError("");
    setAccepted(new Set());
    const file = await pickXml();
    if (!file) return;
    const loaded = await loadCompetition(pgnPath);
    if (!loaded) {
      setError(t("Competition.NotACompetition"));
      return;
    }
    const result = previewResync(loaded, file.xml);
    setPicked(file);
    setIssues(result.issues);
    setPreview(hasCompetition(result) ? result : null);
  }

  const conflicts = useMemo(
    () => preview?.plan.rows.filter((r) => r.kind === "conflict") ?? [],
    [preview],
  );
  const changed = useMemo(
    () => preview?.plan.rows.filter((r) => r.kind !== "unchanged" && r.kind !== "conflict") ?? [],
    [preview],
  );

  function toggle(round: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  }

  async function apply() {
    if (!preview || !picked) return;
    setBusy(true);
    setError("");
    try {
      // Re-read: the file may have changed since the preview was built.
      const loaded = await loadCompetition(pgnPath);
      if (!loaded) throw new Error(t("Competition.NotACompetition"));
      const fresh = previewResync(loaded, picked.xml);
      if (!hasCompetition(fresh)) throw new Error(t("Competition.Sync.Unreadable"));
      const { games } = await applyResync({
        loaded,
        preview: fresh,
        sourceFileName: picked.fileName,
        xml: picked.xml,
        acceptedConflicts: [...accepted],
      });
      notifications.show({
        title: t("Competition.Sync.Title"),
        message: t("Competition.Sync.Done", { count: games.length }),
        color: "teal",
      });
      onChanged();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const counts = preview?.plan.counts;
  const nothingToDo =
    counts != null && counts.added + counts.fill + counts.update + counts.conflict === 0;

  return (
    <Modal opened={opened} onClose={close} title={t("Competition.Sync.Title")} size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Competition.Sync.Help")}
        </Text>
        <Group>
          <Button variant="default" onClick={choose}>
            {t("Competition.PickXml")}
          </Button>
          {picked && (
            <Text size="sm" c="dimmed">
              {picked.fileName}
            </Text>
          )}
        </Group>

        <IssueList issues={issues} />

        {preview?.unchangedSource && (
          <Alert color="blue" variant="light">
            {t("Competition.Sync.SameFile")}
          </Alert>
        )}

        {counts && (
          <>
            <Paper withBorder p="sm">
              <SimpleGrid cols={5}>
                {(["added", "fill", "update", "conflict", "unchanged"] as SyncRowKind[]).map(
                  (kind) => (
                    <Stat
                      key={kind}
                      label={kindLabel(t, kind)}
                      value={
                        <Text fw={600} c={counts[kind] > 0 ? KIND_COLOR[kind] : undefined}>
                          {counts[kind]}
                        </Text>
                      }
                    />
                  ),
                )}
              </SimpleGrid>
            </Paper>

            {nothingToDo && (
              <Alert color="teal" variant="light">
                {t("Competition.Sync.UpToDate")}
              </Alert>
            )}

            {conflicts.length > 0 && (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={600} size="sm">
                    {t("Competition.Sync.ConflictsTitle", { n: conflicts.length })}
                  </Text>
                  <Group gap="xs">
                    <Button
                      size="compact-xs"
                      variant="default"
                      onClick={() => setAccepted(new Set(conflicts.map((c) => c.round)))}
                    >
                      {t("Competition.Sync.AcceptAll")}
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="default"
                      onClick={() => setAccepted(new Set())}
                    >
                      {t("Competition.Sync.AcceptNone")}
                    </Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">
                  {t("Competition.Sync.ConflictsHelp")}
                </Text>
                <ScrollArea.Autosize mah={260}>
                  <Table stickyHeader verticalSpacing="xs">
                    <Table.Tbody>
                      {conflicts.map((row) => (
                        <Table.Tr key={row.round}>
                          <Table.Td w={40}>
                            <Checkbox
                              size="xs"
                              checked={accepted.has(row.round)}
                              onChange={() => toggle(row.round)}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" fw={500}>
                              {row.round} · {row.label}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <ChangeSummary row={row} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </Stack>
            )}

            {changed.length > 0 && (
              <ScrollArea.Autosize mah={200}>
                <Table verticalSpacing={2}>
                  <Table.Tbody>
                    {changed.map((row) => (
                      <Table.Tr key={row.round}>
                        <Table.Td w={90}>
                          <Badge size="xs" variant="light" color={KIND_COLOR[row.kind]}>
                            {kindLabel(t, row.kind)}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            {row.round} · {row.label}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <ChangeSummary row={row} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}

            {preview.plan.orphans.length > 0 && (
              <Alert color="orange" variant="light">
                {t("Competition.Sync.Orphans", { n: preview.plan.orphans.length })}
              </Alert>
            )}
            {preview.plan.duplicates.length > 0 && (
              <Alert color="orange" variant="light">
                {t("Competition.Sync.Duplicates", {
                  rounds: preview.plan.duplicates.join(", "),
                })}
              </Alert>
            )}
          </>
        )}

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            {t("Common.Cancel")}
          </Button>
          <Button loading={busy} disabled={!preview || nothingToDo} onClick={apply}>
            {t("Competition.Sync.Apply")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

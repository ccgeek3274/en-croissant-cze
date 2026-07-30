import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCompetitions, getCompetitionSchedule, getRoundMatches } from "@/utils/chesscz/client";
import {
  type CompetitionLabels,
  composeEventName,
  computeCompetitionLabels,
} from "@/utils/chesscz/labels";
import {
  boardGameToHeaders,
  buildPlaceholderGames,
  type ChessczMatchPairing,
  type ChessczRoundSchedule,
  DEFAULT_BOARD_COUNT,
  findMatch,
  formatMatchScore,
  gamesToPgn,
  isPlayablePairing,
  type ScaffoldGame,
} from "@/utils/chesscz/pgn";

type CompetitionOption = { value: string; label: string; group: string; name: string };

export function ChessczImportDialog({
  opened,
  onClose,
  onImport,
}: {
  opened: boolean;
  onClose: () => void;
  onImport: (pgn: string, suggestedName: string) => void;
}) {
  const { t } = useTranslation();

  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [loadingComps, setLoadingComps] = useState(false);
  const [compId, setCompId] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<ChessczRoundSchedule[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [round, setRound] = useState<string | null>(null);

  // Free-form competition number: works for competitions missing from the current-season
  // catalog (past seasons, or a new season whose search entry isn't listed yet).
  const [directCompId, setDirectCompId] = useState<string | number>("");

  const [labels, setLabels] = useState<CompetitionLabels | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const catalogCompName = useMemo(
    () => competitions.find((c) => c.value === compId)?.name ?? "",
    [competitions, compId],
  );
  // Prefer the authoritative name resolved from the API (covers direct-compId entry).
  const compName = labels?.compName || catalogCompName;

  // Load the competition catalog when the dialog opens.
  useEffect(() => {
    if (!opened) return;
    setError("");
    if (competitions.length > 0) return;
    setLoadingComps(true);
    getCompetitions()
      .then((byRegion) => {
        const opts: CompetitionOption[] = [];
        for (const region of Object.values(byRegion)) {
          for (const c of region.competitions ?? []) {
            opts.push({
              value: String(c.compId),
              label: c.compName,
              name: c.compName,
              group: region.regionName,
            });
          }
        }
        setCompetitions(opts);
      })
      .catch(() => setError(t("Chesscz.Import.LoadError")))
      .finally(() => setLoadingComps(false));
  }, [opened, competitions.length, t]);

  // Load the schedule when a competition is picked.
  useEffect(() => {
    setRound(null);
    setSchedule([]);
    setSelectedKeys([]);
    if (!compId) return;
    setLoadingSchedule(true);
    setError("");
    getCompetitionSchedule(Number(compId))
      .then(setSchedule)
      .catch(() => setError(t("Chesscz.Import.LoadError")))
      .finally(() => setLoadingSchedule(false));
  }, [compId, t]);

  // Resolve short team labels + the Event-tag prefix for the whole competition.
  // Best-effort: on failure `labels` stays null and the import falls back to full names.
  useEffect(() => {
    setLabels(null);
    if (!compId) return;
    let cancelled = false;
    computeCompetitionLabels(Number(compId))
      .then((res) => {
        if (!cancelled) setLabels(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [compId]);

  const competitionData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const c of competitions) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)!.push({ value: c.value, label: c.label });
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [competitions]);

  const currentRound = useMemo(
    () => schedule.find((r) => String(r.roundNr) === round),
    [schedule, round],
  );

  const playablePairings = useMemo(
    () => (currentRound?.roundMatches ?? []).filter(isPlayablePairing),
    [currentRound],
  );

  const roundData = useMemo(
    () =>
      schedule.map((r) => ({
        value: String(r.roundNr),
        label: `${r.roundNr}. ${t("Chesscz.Import.Round").toLowerCase()} — ${r.roundDate} (${
          r.roundMatches.filter(isPlayablePairing).length
        })`,
      })),
    [schedule, t],
  );

  // Default: all matches of the round selected.
  useEffect(() => {
    setSelectedKeys(playablePairings.map(pairingKey));
  }, [playablePairings]);

  async function doImport() {
    if (!currentRound || !compId) return;
    const chosen = playablePairings.filter((p) => selectedKeys.includes(pairingKey(p)));
    if (chosen.length === 0) return;

    setBusy(true);
    setError("");
    try {
      const results = await getRoundMatches(Number(compId), currentRound.roundNr);
      const games: ScaffoldGame[] = [];
      for (const pairing of chosen) {
        const eventName = composeEventName(
          labels,
          pairing.homeTeamId,
          pairing.homeTeamName,
          pairing.awayTeamId,
          pairing.awayTeamName,
          compName,
        );
        const match = findMatch(results, pairing.homeTeamId, pairing.awayTeamId);
        if (match && match.matchGames.length > 0) {
          match.matchGames.forEach((g, idx) => {
            games.push({
              headers: boardGameToHeaders(match, g, idx, eventName, currentRound.roundDate),
              movesPgn: "",
            });
          });
        } else {
          games.push(
            ...buildPlaceholderGames({
              event: eventName,
              roundNr: currentRound.roundNr,
              roundDate: currentRound.roundDate,
              homeTeamName: pairing.homeTeamName,
              awayTeamName: pairing.awayTeamName,
              boardCount: DEFAULT_BOARD_COUNT,
            }),
          );
        }
      }
      const pgn = gamesToPgn(games);
      const name = `${compName} ${currentRound.roundNr}. ${t("Chesscz.Import.Round").toLowerCase()}`;
      onImport(pgn, name);
      onClose();
    } catch {
      setError(t("Chesscz.Import.LoadError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Chesscz.Import.Title")} size="lg">
      <Stack>
        <Select
          label={t("Chesscz.Import.Competition")}
          placeholder={t("Chesscz.Import.SelectCompetition")}
          data={competitionData}
          value={compId}
          onChange={setCompId}
          searchable
          disabled={loadingComps}
          rightSection={loadingComps ? <Loader size="xs" /> : undefined}
          nothingFoundMessage={t("Common.NoResults")}
        />

        <Group align="flex-end" gap="sm">
          <NumberInput
            label={t("Chesscz.Import.DirectCompId")}
            placeholder={t("Chesscz.Import.DirectCompIdPlaceholder")}
            value={directCompId}
            onChange={setDirectCompId}
            min={1}
            allowDecimal={false}
            allowNegative={false}
            hideControls
            style={{ flex: 1 }}
          />
          <Button
            variant="default"
            disabled={!directCompId || Number(directCompId) <= 0}
            onClick={() => setCompId(String(Number(directCompId)))}
          >
            {t("Chesscz.Import.Load")}
          </Button>
        </Group>

        {labels?.prefix && (
          <Text c="dimmed" size="xs">
            {t("Chesscz.Import.EventPrefix")}: {labels.prefix}
          </Text>
        )}

        <Select
          label={t("Chesscz.Import.Round")}
          placeholder={t("Chesscz.Import.SelectRound")}
          data={roundData}
          value={round}
          onChange={setRound}
          disabled={!compId || loadingSchedule}
          rightSection={loadingSchedule ? <Loader size="xs" /> : undefined}
          nothingFoundMessage={t("Common.NoResults")}
        />

        {currentRound && playablePairings.length > 0 && (
          <Checkbox.Group
            label={t("Chesscz.Import.Matches")}
            value={selectedKeys}
            onChange={setSelectedKeys}
          >
            <ScrollArea.Autosize mah={220}>
              <Stack gap="xs" pt="xs">
                {playablePairings.map((p) => (
                  <Checkbox
                    key={pairingKey(p)}
                    value={pairingKey(p)}
                    label={
                      <Text size="sm">
                        {p.homeTeamName} – {p.awayTeamName}{" "}
                        <Text span c="dimmed">
                          {formatMatchScore(p.homeTeamScore, p.awayTeamScore)}
                        </Text>
                      </Text>
                    }
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Checkbox.Group>
        )}

        {currentRound && playablePairings.length === 0 && (
          <Text c="dimmed" size="sm">
            {t("Chesscz.Import.NoMatches")}
          </Text>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertCircle size="1rem" />}>
            {error}
          </Alert>
        )}

        <Text c="dimmed" size="xs">
          {t("Chesscz.Import.Note")}
        </Text>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button onClick={doImport} loading={busy} disabled={selectedKeys.length === 0}>
            {t("Chesscz.Import.Generate")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function pairingKey(p: ChessczMatchPairing): string {
  return `${p.homeTeamId}-${p.awayTeamId}`;
}

import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
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

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const compName = useMemo(
    () => competitions.find((c) => c.value === compId)?.name ?? "",
    [competitions, compId],
  );

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
        const match = findMatch(results, pairing.homeTeamId, pairing.awayTeamId);
        if (match && match.matchGames.length > 0) {
          match.matchGames.forEach((g, idx) => {
            games.push({
              headers: boardGameToHeaders(match, g, idx, compName, currentRound.roundDate),
              movesPgn: "",
            });
          });
        } else {
          games.push(
            ...buildPlaceholderGames({
              compName,
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

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconEdit,
  IconFileExport,
  IconFileImport,
  IconListCheck,
  IconRefresh,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openCompetitionTab } from "@/utils/competitionTab";
import { openFile } from "@/utils/files";
import { capitalize } from "@/utils/format";
import { isCompetitionFile } from "@/utils/sscr/storage";
import { unwrap } from "@/utils/unwrap";
import GamePreview from "../databases/GamePreview";
import GameSelector from "../panels/info/GameSelector";
import { CompetitionResyncModal } from "./CompetitionDialogs";
import type { FileMetadata } from "./file";
import { ExportPgnModal, ImportGamesModal, KontrolaModal } from "./PgnToolsDialogs";

function FileCard({
  selected,
  games,
  setGames,
  toggleEditModal,
  mutate,
}: {
  selected: FileMetadata;
  games: Map<number, string>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  toggleEditModal: () => void;
  mutate: () => void;
}) {
  const { t } = useTranslation();

  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();

  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [kontrolaOpen, setKontrolaOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  // A .pgn with a manifest beside it is a competition — it gets the XML actions.
  const [isCompetition, setIsCompetition] = useState(false);

  function onChanged() {
    setGames(new Map());
    setPage(0);
    mutate();
  }

  useEffect(() => {
    setPage(0);
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    setIsCompetition(false);
    isCompetitionFile(selected.path).then((yes) => {
      if (!cancelled) setIsCompetition(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [selected.path]);

  useEffect(() => {
    async function loadGames() {
      const data = unwrap(await commands.readGames(selected.path, page, page));

      setSelectedGame(data[0]);
    }
    loadGames();
  }, [selected, page]);

  async function openGame() {
    await openFile(selected, setTabs, setActiveTab, {
      gameNumber: page,
      pgn: selectedGame || "",
    });
    navigate({ to: "/" });
  }

  async function openCompetition() {
    await openCompetitionTab(selected, setTabs, setActiveTab);
    navigate({ to: "/" });
  }

  return (
    <Stack h="100%">
      <Stack align="center">
        <Text ta="center" fz="xl" fw="bold">
          {selected?.name}
        </Text>
        <Badge>{t(`Files.FileType.${capitalize(selected.metadata.type)}`)}</Badge>
        {isCompetition && (
          <Button size="xs" onClick={openCompetition}>
            {t("Competition.Open")}
          </Button>
        )}
      </Stack>
      <Divider />

      <Group align="center" grow px="xs">
        <Group>
          <Tooltip label={t("Common.Open")}>
            <ActionIcon size="sm" onClick={openGame}>
              <IconZoomCheck />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Files.EditMetadata")}>
            <ActionIcon size="sm" onClick={() => toggleEditModal()}>
              <IconEdit />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("PgnTools.Kontrola.Title")}>
            <ActionIcon size="sm" variant="default" onClick={() => setKontrolaOpen(true)}>
              <IconListCheck />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("PgnTools.Import.Title")}>
            <ActionIcon size="sm" variant="default" onClick={() => setImportOpen(true)}>
              <IconFileImport />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("PgnTools.Export.Title")}>
            <ActionIcon size="sm" variant="default" onClick={() => setExportOpen(true)}>
              <IconFileExport />
            </ActionIcon>
          </Tooltip>
          {isCompetition && (
            <Tooltip label={t("Competition.Sync.Title")}>
              <ActionIcon size="sm" variant="default" onClick={() => setResyncOpen(true)}>
                <IconRefresh />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
        <Text ta="center" c="dimmed">
          {selected?.numGames} {t("Common.Games")}
        </Text>
        <div />
      </Group>

      {selectedGame && (
        <>
          <Box h={0} flex={1}>
            <Divider />
            <GameSelector
              setGames={setGames}
              games={games}
              activePage={page}
              path={selected.path}
              setPage={setPage}
              total={selected.numGames}
            />
            <Divider />
          </Box>
          <Box h="55%" px="xs" pb="xs">
            <GamePreview pgn={selectedGame} />
          </Box>
        </>
      )}

      <KontrolaModal
        opened={kontrolaOpen}
        onClose={() => setKontrolaOpen(false)}
        file={selected}
        onChanged={onChanged}
      />
      <ExportPgnModal opened={exportOpen} onClose={() => setExportOpen(false)} file={selected} />
      <ImportGamesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        file={selected}
        onChanged={onChanged}
      />
      {isCompetition && (
        <CompetitionResyncModal
          opened={resyncOpen}
          onClose={() => setResyncOpen(false)}
          pgnPath={selected.path}
          onChanged={onChanged}
        />
      )}
    </Stack>
  );
}

export default FileCard;

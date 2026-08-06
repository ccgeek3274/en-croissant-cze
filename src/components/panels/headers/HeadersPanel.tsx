// "Hlavičky" — a faithful port of pgn-base's database grid, adapted to en-croissant.
// It lists the current tab's games as a data grid of PGN tags, with Standardní /
// Plný / Zápasový views, inline bulk editing (Upravit) written back to disk, and the
// shared Kontrola report (reused from PgnToolsDialogs). The grid itself lives in
// `HeadersGrid`, shared with the competition-leader mode.
//
// "The current tab's games" is usually every game in the file, but a tab opened out
// of a competition carries a scope (one round, one match, one game) — see
// `scopedIndices`. The grid is told which indices to show; everything it writes
// still addresses the whole file.

import { Button, Stack, Text } from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { commands } from "@/bindings";
import { GameScopeChip } from "@/components/common/GameScopeChip";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  ExportPgnModal,
  ImportGamesModal,
  KontrolaModal,
} from "@/components/files/PgnToolsDialogs";
import ConfirmChangesModal from "@/components/tabs/ConfirmChangesModal";
import { activeTabAtom, currentTabAtom, tabsAtom } from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { openCompetitionTab } from "@/utils/competitionTab";
import { isCompetitionFile } from "@/utils/sscr/storage";
import { getTabFile, getTabGameNumber, scopedIndices } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { HeadersGrid } from "./HeadersGrid";

function HeadersPanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const dirty = useStore(store, (s) => s.dirty);
  const setState = useStore(store, (s) => s.setState);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const tabFile = getTabFile(currentTab);
  const gameNumber = getTabGameNumber(currentTab);
  const isMatch = tabFile?.metadata.type === "tournament";

  const [games, setGames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [kontrolaOpen, setKontrolaOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // A game opened out of a competition offers a way back up to the whole season.
  const [isCompetition, setIsCompetition] = useState(false);

  // Confirm-changes modal shared with game navigation (unsaved board analysis).
  const [confirmChanges, toggleConfirmChanges] = useToggle();
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  const path = tabFile?.path;
  const numGames = tabFile?.numGames ?? 0;
  const scope = currentTab?.gameScope;
  const rows = useMemo(() => scopedIndices(currentTab, games.length), [currentTab, games.length]);

  useEffect(() => {
    let cancelled = false;
    setIsCompetition(false);
    if (!tabFile) return;
    isCompetitionFile(tabFile.path).then((yes) => {
      if (!cancelled) setIsCompetition(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [tabFile]);

  const reload = useCallback(async () => {
    if (!path || numGames <= 0) {
      setGames([]);
      return;
    }
    setLoading(true);
    try {
      setGames(unwrap(await commands.readGames(path, 0, numGames - 1)));
    } finally {
      setLoading(false);
    }
  }, [path, numGames]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function loadGame(index: number, forced?: boolean) {
    if (!path) return;
    if (!forced && dirty) {
      setPendingIdx(index);
      toggleConfirmChanges();
      return;
    }
    const data = unwrap(await commands.readGames(path, index, index));
    setState(await parsePGN(data[0]));
    setCurrentTab((prev) => {
      if (prev.gameOrigin.kind !== "file" && prev.gameOrigin.kind !== "temp_file") return prev;
      return { ...prev, gameOrigin: { ...prev.gameOrigin, gameNumber: index } };
    });
  }

  // Refresh the open board only when it has no unsaved moves of its own, so we
  // never clobber in-progress analysis with the on-disk version.
  async function onWritten(next: string[], touched: number[]) {
    if (touched.includes(gameNumber) && !dirty) {
      setState(await parsePGN(next[gameNumber]));
    }
  }

  if (!tabFile) {
    return (
      <Text p="sm" c="dimmed">
        {t("Headers.NoFile")}
      </Text>
    );
  }

  return (
    <Stack h="100%" gap="xs" p="xs">
      <GameScopeChip />
      <HeadersGrid
        path={path}
        games={games}
        rows={rows}
        activeIndex={gameNumber}
        onOpen={loadGame}
        onReload={reload}
        onWritten={onWritten}
        // Board order only reads as a match when the rows *are* one match: over a
        // whole round it interleaves six of them.
        matchView={scope ? (scope.matchLevel ?? false) : isMatch}
        canRecomputeActive={scope === undefined || rows.includes(gameNumber)}
        loading={loading}
        toolbar={
          <>
            <Button size="xs" variant="default" onClick={() => setKontrolaOpen(true)}>
              {t("PgnTools.Kontrola.Title")}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={numGames === 0}
              onClick={() => setImportOpen(true)}
            >
              {t("PgnTools.Import.Title")}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={numGames === 0}
              onClick={() => setExportOpen(true)}
            >
              {t("PgnTools.Export.Title")}
            </Button>
            {isCompetition && (
              <Button size="xs" onClick={() => openCompetitionTab(tabFile, setTabs, setActiveTab)}>
                {t("Competition.Open")}
              </Button>
            )}
          </>
        }
      />

      <ConfirmChangesModal
        opened={confirmChanges}
        toggle={toggleConfirmChanges}
        closeTab={() => {
          if (pendingIdx !== null) void loadGame(pendingIdx, true);
        }}
      />
      {/* Scoped tab, scoped tools: checking or exporting a whole season from a tab
          that is showing one round is never what was meant. `ToolScope` has the
          shape of `GameScope` and splices its results back into the whole file. */}
      <KontrolaModal
        opened={kontrolaOpen}
        onClose={() => setKontrolaOpen(false)}
        file={tabFile}
        onChanged={reload}
        scope={scope}
        matchChecks={scope ? (scope.matchLevel ?? false) : undefined}
      />
      <ImportGamesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        file={tabFile}
        onChanged={reload}
        scope={scope}
      />
      <ExportPgnModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        file={tabFile}
        scope={scope}
        matchChecks={scope ? (scope.matchLevel ?? false) : undefined}
      />
    </Stack>
  );
}

export default HeadersPanel;

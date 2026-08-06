// The competition-leader mode as a tab (see `utils/competitionTab.ts` for why).
//
// Thin wrapper: it resolves the tab's file and gives `CompetitionView` the one
// thing it cannot do itself — hand a single game over to an analysis board.

import { Center, Text } from "@mantine/core";
import { useAtom, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import { getTabFile, type Tab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { CompetitionView } from "./CompetitionView";

export default function CompetitionTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const file = getTabFile(tab);
  if (!file) {
    return (
      <Center h="100%">
        <Text c="dimmed">{t("Competition.NotACompetition")}</Text>
      </Center>
    );
  }

  return (
    <CompetitionView
      file={file}
      onChanged={() => {}}
      onOpenGame={async (gameIndex, scope) => {
        const data = unwrap(await commands.readGames(file.path, gameIndex, gameIndex));
        await openFile(file, setTabs, setActiveTab, {
          gameNumber: gameIndex,
          pgn: data[0] ?? "",
          scope,
        });
      }}
    />
  );
}

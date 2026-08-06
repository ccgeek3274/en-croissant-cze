// A tab opened out of the competition-leader mode is looking at one round, or one
// match, not at the whole season file. Nothing else on the board says so, and a
// game list that silently hides 144 of 192 games is a bug report waiting to happen
// — so wherever a scoped list is shown, this names the scope and offers the way
// back to the whole file.

import { Badge, CloseButton, Group } from "@mantine/core";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { currentTabAtom } from "@/state/atoms";
import { getTabScope } from "@/utils/tabs";

export function GameScopeChip({ px }: { px?: string | number }) {
  const { t } = useTranslation();
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const scope = getTabScope(currentTab);
  if (!scope) return null;

  return (
    <Group px={px} gap="xs" wrap="nowrap">
      <Badge
        size="sm"
        variant="light"
        style={{ maxWidth: "100%" }}
        rightSection={
          <CloseButton
            size={14}
            iconSize={12}
            aria-label={t("Headers.Scope.Clear")}
            title={t("Headers.Scope.Clear")}
            onClick={() => setCurrentTab((prev) => ({ ...prev, gameScope: undefined }))}
          />
        }
      >
        {t("Competition.Headers.Scope", { label: scope.label, count: scope.indices.length })}
      </Badge>
    </Group>
  );
}

import { Badge, Combobox, Group, Loader, Text, useCombobox } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { MIN_QUERY_LEN, useChessczSearch } from "@/utils/chesscz/useChessczSearch";
import { type ChessczMember, toPgnPlayerName } from "@/utils/chesscz/pgn";

/** Natural "Surname Given" form, for display in the dropdown. */
export function chessczMemberDisplayName(p: ChessczMember): string {
  return (p.fullName ?? "").trim().replace(/\s+/g, " ");
}

/** PGN "Surname, Given" form, for the header field value. */
export function chessczMemberName(p: ChessczMember): string {
  return toPgnPlayerName(p.fullName);
}

/** Preferred Elo for a member: FIDE standard if rated, otherwise national (ČŠS). */
export function chessczMemberElo(p: ChessczMember): number | undefined {
  if (p.fideStdElo && p.fideStdElo > 0) return p.fideStdElo;
  if (p.czeStdElo && p.czeStdElo > 0) return p.czeStdElo;
  return undefined;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (p: ChessczMember) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

// Player-name input backed by api.chess.cz (ŠSČR) search. Visually a bare input
// (so it drops into the existing header grid); the dropdown adds suggestions.
export function ChessczPlayerAutocomplete({
  value,
  onChange,
  onPick,
  className,
  placeholder,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const combobox = useCombobox();
  const { players, isFetching, pending, error } = useChessczSearch(value);

  const longEnough = value.trim().length >= MIN_QUERY_LEN;
  const loading = pending || isFetching;

  const options = players.map((p) => {
    const elo = chessczMemberElo(p);
    return (
      <Combobox.Option value={String(p.czeId)} key={p.czeId}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {chessczMemberDisplayName(p)}
              {p.birthYear ? (
                <Text span c="dimmed" fw={400}>
                  {" "}
                  ({p.birthYear})
                </Text>
              ) : null}
            </Text>
            {p.clubName ? (
              <Text size="xs" c="dimmed" truncate>
                {p.clubName.trim()}
              </Text>
            ) : null}
          </div>
          {elo ? (
            <Badge variant="light" size="sm" radius="sm">
              {elo}
            </Badge>
          ) : null}
        </Group>
      </Combobox.Option>
    );
  });

  return (
    <Combobox
      store={combobox}
      withinPortal
      onOptionSubmit={(val) => {
        const p = players.find((x) => String(x.czeId) === val);
        if (p) {
          onPick(p);
          onChange(chessczMemberName(p));
        }
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <input
          className={className}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.currentTarget.value);
            combobox.openDropdown();
            combobox.resetSelectedOption();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>

      <Combobox.Dropdown hidden={!longEnough}>
        <Combobox.Options>
          {loading && players.length === 0 ? (
            <Combobox.Empty>
              <Group gap="xs" justify="center">
                <Loader size="xs" />
                {t("Chesscz.Searching")}
              </Group>
            </Combobox.Empty>
          ) : error ? (
            <Combobox.Empty>{t("Chesscz.SearchError")}</Combobox.Empty>
          ) : players.length === 0 ? (
            <Combobox.Empty>{t("Common.NoResults")}</Combobox.Empty>
          ) : (
            options
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

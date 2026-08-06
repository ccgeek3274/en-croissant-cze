import { ActionIcon, Box, Group, ScrollArea, Text } from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { IconX } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import cx from "clsx";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { commands } from "@/bindings";
import ConfirmModal from "@/components/common/ConfirmModal";
import { fontSizeAtom } from "@/state/atoms";
import { parsePGN } from "@/utils/chess";
import { formatNumber } from "@/utils/format";
import { getGameName } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";
import classes from "./GameSelector.module.css";

export default function GameSelector({
  games,
  setGames,
  setPage,
  total,
  indices,
  path,
  activePage,
  deleteGame,
}: {
  games: Map<number, string>;
  setGames: React.Dispatch<React.SetStateAction<Map<number, string>>>;
  setPage: (v: number) => void;
  total: number;
  /** Show only these games, in this order, as indices into the file. Omitted =
   *  every game, where a row number and a file index are the same thing. */
  indices?: number[];
  path: string;
  activePage: number;
  deleteGame?: (index: number) => void;
}) {
  // A row on screen and a game in the file stop being the same number the moment
  // a scope is in play. Everything the selector hands out or compares — the games
  // map, `activePage`, `setPage`, `deleteGame` — speaks file indices; only the
  // virtualiser speaks rows, and this is the one place they meet.
  const fileIndex = useCallback((row: number) => (indices ? indices[row] : row), [indices]);
  const rowCount = indices ? indices.length : total;

  const loadMoreRows = useCallback(
    async (startRow: number, stopRow: number) => {
      const first = fileIndex(startRow);
      const last = fileIndex(stopRow);
      if (first === undefined || last === undefined) return;
      // One read spanning the visible window: with a scope it can cover a few
      // games that are not on screen, which is far cheaper than a call per row.
      const data = unwrap(await commands.readGames(path, first, last));
      const names = await Promise.all(
        data.map(async (game) => getGameName((await parsePGN(game)).headers)),
      );
      setGames((prev) => {
        const next = new Map(prev);
        names.forEach((name, i) => next.set(first + i, name));
        return next;
      });
    },
    [fileIndex, path, setGames],
  );

  const fontSize = useAtomValue(fontSizeAtom);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    estimateSize: () => 30 * (fontSize / 100),
    getScrollElement: () => parentRef.current!,
  });

  useEffect(() => {
    if (rowCount === 0) return;
    if (games.size === 0) {
      loadMoreRows(0, Math.min(10, rowCount - 1));
    }
    const items = rowVirtualizer.getVirtualItems();
    if (items.length > 0 && items.some((item) => !games.has(fileIndex(item.index)))) {
      loadMoreRows(items[0].index, items[items.length - 1].index);
    }
  }, [games, fileIndex, rowCount, loadMoreRows, rowVirtualizer.getVirtualItems()]);

  return (
    <ScrollArea viewportRef={parentRef} h="100%">
      <Box
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <GameRow
            key={virtualRow.index}
            index={fileIndex(virtualRow.index)}
            game={games.get(fileIndex(virtualRow.index))}
            setGames={setGames}
            setPage={setPage}
            deleteGame={deleteGame}
            activePage={activePage}
            path={path}
            total={total}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          />
        ))}
      </Box>
    </ScrollArea>
  );
}

function GameRow({
  style,
  index,
  game,
  setPage,
  activePage,
  deleteGame,
}: {
  style?: React.CSSProperties;
  index: number;
  game: string | undefined;
  setGames: (v: Map<number, string>) => void;
  setPage: (v: number) => void;
  path: string;
  total: number;
  activePage: number;
  deleteGame?: (indxe: number) => void;
}) {
  const [deleteModal, toggleDelete] = useToggle();

  return (
    <>
      {deleteGame && (
        <ConfirmModal
          title={"Remove game"}
          description={"Are you sure you want to remove this game?"}
          opened={deleteModal}
          onClose={toggleDelete}
          onConfirm={() => {
            deleteGame(index);
            toggleDelete();
          }}
        />
      )}
      <Group
        style={style}
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        className={cx(classes.row, {
          [classes.active]: index === activePage,
        })}
        onClick={() => {
          setPage(index);
        }}
      >
        <Text fz="xs" className={classes.index}>
          {formatNumber(index + 1)}
        </Text>
        <Text fz="sm" truncate flex={1} lh="sm">
          {game || "..."}
        </Text>
        {deleteGame && (
          <ActionIcon
            onClick={(e) => {
              e.stopPropagation();
              toggleDelete();
            }}
            variant="subtle"
            color="red"
            size="xs"
            mr="xs"
            className={classes.deleteBtn}
          >
            <IconX size={12} />
          </ActionIcon>
        )}
      </Group>
    </>
  );
}

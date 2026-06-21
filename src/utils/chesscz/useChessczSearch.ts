import { useDebouncedValue } from "@mantine/hooks";
import useSWR from "swr";
import { MIN_QUERY_LEN, searchMembers } from "./client";
import type { ChessczMember } from "./pgn";

export { MIN_QUERY_LEN };

// Debounced player search against api.chess.cz. The shared client caches results
// and enforces the ~1 req/s floor, so this can fire on a light debounce.
export function useChessczSearch(query: string) {
    const trimmed = query.trim();
    const [debounced] = useDebouncedValue(trimmed, 300);
    const enabled = debounced.length >= MIN_QUERY_LEN;

    const { data, error, isLoading } = useSWR<ChessczMember[]>(
        enabled ? ["chesscz-search", debounced] : null,
        () => searchMembers(debounced),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    return {
        players: data ?? [],
        error,
        isFetching: isLoading,
        debouncedQuery: debounced,
        // true while the user typed something new that the debounce hasn't caught up to
        pending: enabled && trimmed !== debounced,
    };
}

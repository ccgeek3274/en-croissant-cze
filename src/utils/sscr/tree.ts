// The competition → round → match → game tree, derived from the games themselves.
//
// The `Round` tag (kolo.zápas.šachovnice) already carries the structure, so the
// tree is a *view*, not stored state: no node ids to keep in sync, and a file that
// drifted from its manifest still produces a usable tree. The manifest only fills
// in labels (team names for a match that has no games yet).
//
// Every node knows the indices of the games it covers, which is what lets header
// editing, Kontrola, import and export all run "at this level" over one array.

import { getTag, splitGame } from "@/utils/pgn/tags";
import type { CompetitionManifest } from "./manifest";
import { type GameKey, gameKeyOrder, parseRoundTag } from "./skeleton";
import { hasMoves, isUninformative } from "./sync";

export type NodeStats = {
    total: number;
    withMoves: number;
    /** Result is not "*". */
    decided: number;
    /** Games still carrying a scaffold or "?" player name. */
    placeholders: number;
    forfeits: number;
};

export type GameNode = {
    kind: "game";
    id: string;
    key: GameKey;
    /** Index into the file's game list. */
    index: number;
    boardNr: number;
    white: string;
    black: string;
    result: string;
    hasMoves: boolean;
    forfeit: boolean;
};

export type MatchNode = {
    kind: "match";
    id: string;
    roundNr: number;
    matchNr: number;
    homeTeam: string;
    awayTeam: string;
    /** Match score from the games' results, home first. */
    homeScore: number;
    awayScore: number;
    stats: NodeStats;
    indices: number[];
    games: GameNode[];
};

export type RoundNode = {
    kind: "round";
    id: string;
    roundNr: number;
    date: string;
    stats: NodeStats;
    indices: number[];
    matches: MatchNode[];
};

export type CompetitionNode = {
    kind: "competition";
    id: string;
    name: string;
    stats: NodeStats;
    indices: number[];
    rounds: RoundNode[];
    /** Games whose Round tag is not kolo.zápas.šachovnice — kept visible, not hidden. */
    strays: GameNode[];
};

/** A selected level: which games it covers, and what to call it. */
export type Scope = {
    id: string;
    label: string;
    indices: number[];
};

const EMPTY_STATS = (): NodeStats => ({
    total: 0,
    withMoves: 0,
    decided: 0,
    placeholders: 0,
    forfeits: 0,
});

function addStats(into: NodeStats, game: GameNode): void {
    into.total++;
    if (game.hasMoves) into.withMoves++;
    if (game.result !== "*" && game.result !== "") into.decided++;
    if (isUninformative(game.white) || isUninformative(game.black)) into.placeholders++;
    if (game.forfeit) into.forfeits++;
}

function mergeStats(into: NodeStats, from: NodeStats): void {
    into.total += from.total;
    into.withMoves += from.withMoves;
    into.decided += from.decided;
    into.placeholders += from.placeholders;
    into.forfeits += from.forfeits;
}

/** Points the home team scored on one board. Odd boards have home as White. */
function homePoints(game: GameNode): number {
    const homeIsWhite = game.boardNr % 2 === 1;
    if (game.result === "1/2-1/2") return 0.5;
    if (game.result === "1-0") return homeIsWhite ? 1 : 0;
    if (game.result === "0-1") return homeIsWhite ? 0 : 1;
    return 0;
}

function parseGame(text: string, index: number): { key: GameKey | null; node: GameNode } {
    const { tags, movetext } = splitGame(text);
    const round = getTag(tags, "Round") ?? "";
    const key = parseRoundTag(round);
    const boardNr = key?.boardNr ?? Number(getTag(tags, "Board") ?? 0);
    return {
        key,
        node: {
            kind: "game",
            id: key ? round : `stray-${index}`,
            key: key ?? { roundNr: 0, matchNr: 0, boardNr: boardNr || 0 },
            index,
            boardNr: boardNr || 0,
            white: getTag(tags, "White") ?? "",
            black: getTag(tags, "Black") ?? "",
            result: getTag(tags, "Result") ?? "",
            hasMoves: hasMoves(movetext),
            forfeit: (getTag(tags, "Termination") ?? "") === "forfeit",
        },
    };
}

/** Team names for a match: board 1 states them directly (home = White on odd
 *  boards); a match with no games at all falls back to the manifest's draw. */
function teamNames(
    games: GameNode[],
    texts: string[],
    roundNr: number,
    matchNr: number,
    manifest?: CompetitionManifest | null,
): { home: string; away: string } {
    for (const g of games) {
        const { tags } = splitGame(texts[g.index]);
        const white = getTag(tags, "WhiteTeam") ?? "";
        const black = getTag(tags, "BlackTeam") ?? "";
        if (!white && !black) continue;
        const homeIsWhite = g.boardNr % 2 === 1;
        return homeIsWhite ? { home: white, away: black } : { home: black, away: white };
    }
    const draw = manifest?.rounds
        .find((r) => r.no === roundNr)
        ?.matches.find((m) => m.no === matchNr);
    const name = (no: number | undefined) =>
        manifest?.teams.find((t) => t.no === no)?.name ?? (no ? `#${no}` : "?");
    return { home: name(draw?.homeTeamNo), away: name(draw?.awayTeamNo) };
}

/** Build the whole tree from a file's games. */
export function buildTree(games: string[], manifest?: CompetitionManifest | null): CompetitionNode {
    const byRoundMatch = new Map<string, GameNode[]>();
    const strays: GameNode[] = [];

    games.forEach((text, index) => {
        const { key, node } = parseGame(text, index);
        if (!key) {
            strays.push(node);
            return;
        }
        const bucket = `${key.roundNr}|${key.matchNr}`;
        const list = byRoundMatch.get(bucket);
        if (list) list.push(node);
        else byRoundMatch.set(bucket, [node]);
    });

    const roundsMap = new Map<number, MatchNode[]>();
    for (const [bucket, list] of byRoundMatch) {
        const [roundNr, matchNr] = bucket.split("|").map(Number);
        list.sort((a, b) => gameKeyOrder(a.key, b.key));

        const stats = EMPTY_STATS();
        for (const g of list) addStats(stats, g);
        const { home, away } = teamNames(list, games, roundNr, matchNr, manifest);

        const match: MatchNode = {
            kind: "match",
            id: `${roundNr}.${matchNr}`,
            roundNr,
            matchNr,
            homeTeam: home,
            awayTeam: away,
            homeScore: list.reduce((sum, g) => sum + homePoints(g), 0),
            awayScore: list.reduce(
                (sum, g) => sum + (g.result === "*" || g.result === "" ? 0 : 1 - homePoints(g)),
                0,
            ),
            stats,
            indices: list.map((g) => g.index),
            games: list,
        };
        const bucketList = roundsMap.get(roundNr);
        if (bucketList) bucketList.push(match);
        else roundsMap.set(roundNr, [match]);
    }

    const rounds: RoundNode[] = [...roundsMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([roundNr, matches]) => {
            matches.sort((a, b) => a.matchNr - b.matchNr);
            const stats = EMPTY_STATS();
            for (const m of matches) mergeStats(stats, m.stats);
            return {
                kind: "round" as const,
                id: String(roundNr),
                roundNr,
                date: manifest?.rounds.find((r) => r.no === roundNr)?.date ?? "",
                stats,
                indices: matches.flatMap((m) => m.indices),
                matches,
            };
        });

    const stats = EMPTY_STATS();
    for (const r of rounds) mergeStats(stats, r.stats);
    for (const s of strays) addStats(stats, s);

    return {
        kind: "competition",
        id: "competition",
        name: manifest?.competition.name ?? "",
        stats,
        indices: games.map((_, i) => i),
        rounds,
        strays,
    };
}

/** Format a match score the way a bulletin does ("4.5:3.5"). */
export function formatScore(home: number, away: number): string {
    const half = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return `${half(home)}:${half(away)}`;
}

/** Find a node's scope by id, searching competition → round → match → game. */
export function findScope(tree: CompetitionNode, id: string): Scope | null {
    if (id === tree.id) {
        return { id, label: tree.name, indices: tree.indices };
    }
    for (const round of tree.rounds) {
        if (round.id === id) {
            return { id, label: `${round.roundNr}. kolo`, indices: round.indices };
        }
        for (const match of round.matches) {
            if (match.id === id) {
                return {
                    id,
                    label: `${match.homeTeam} – ${match.awayTeam}`,
                    indices: match.indices,
                };
            }
            for (const game of match.games) {
                if (game.id === id) {
                    return { id, label: `${game.white} – ${game.black}`, indices: [game.index] };
                }
            }
        }
    }
    for (const stray of tree.strays) {
        if (stray.id === id) {
            return { id, label: `${stray.white} – ${stray.black}`, indices: [stray.index] };
        }
    }
    return null;
}

/** Every game node in the tree, in (round, match, board) order, strays last. */
export function allGameNodes(tree: CompetitionNode): GameNode[] {
    return [...tree.rounds.flatMap((r) => r.matches.flatMap((m) => m.games)), ...tree.strays];
}

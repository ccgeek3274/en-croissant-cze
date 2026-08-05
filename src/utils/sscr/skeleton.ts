// Turn a parsed competition XML into the **full-format** PGN skeleton kept inside
// en-croissant: one game per board of every match of every round, headers filled
// from the XML, movetext empty until a captain sends it.
//
// The `Round` tag carries the identity of a game — `kolo.zápas.šachovnice`, the
// same convention Swiss-Manager uses in its own PGN export. It is the join key for
// re-sync, for merging captains' moves, for the GUI tree and for the ŠSČR export,
// so the skeleton needs no sidecar to know what a game *is*.
//
// Diacritics are kept here; they are stripped at export time only.

import { toPgnName } from "@/utils/pgn/names";
import { type PgnTags, serializeGame } from "@/utils/pgn/tags";
import type { Competition, RosterEntry, XmlBoard, XmlMatch } from "./competitionXml";
import { indexRoster, rosterKey } from "./competitionXml";

export type GameKey = {
    roundNr: number;
    matchNr: number;
    boardNr: number;
};

/** `Round` tag for a game: "kolo.zápas.šachovnice". */
export function formatRoundTag(key: GameKey): string {
    return `${key.roundNr}.${key.matchNr}.${key.boardNr}`;
}

/** Parse a three-level `Round` tag back into a key; null for anything else (a
 *  two-level or free-form Round is not a competition-skeleton game). */
export function parseRoundTag(round: string | null | undefined): GameKey | null {
    const m = /^\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(round ?? "");
    if (!m) return null;
    return { roundNr: Number(m[1]), matchNr: Number(m[2]), boardNr: Number(m[3]) };
}

/** Sort key so a game list is always (round, match, board). */
export function gameKeyOrder(a: GameKey, b: GameKey): number {
    return a.roundNr - b.roundNr || a.matchNr - b.matchNr || a.boardNr - b.boardNr;
}

export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export type BoardOutcome = {
    result: PgnResult;
    /** At least one side carries the XML forfeit marker. */
    forfeit: boolean;
    /** The XML states an outcome (as opposed to "not played yet"). */
    decided: boolean;
};

/** Map a board's `scr1`/`scr2` to a PGN result. The XML states the score from the
 *  **home team's** point of view, so it flips on even boards where home is Black. */
export function boardOutcome(
    home: { value: number; forfeit: boolean },
    away: { value: number; forfeit: boolean },
    homeIsWhite: boolean,
): BoardOutcome {
    const forfeit = home.forfeit || away.forfeit;
    // 0:0 is "no result": either the round has not been played, or both sides
    // forfeited ("0-0F"), which PGN has no way to express.
    if (home.value === 0 && away.value === 0) return { result: "*", forfeit, decided: forfeit };
    if (home.value === away.value) return { result: "1/2-1/2", forfeit, decided: true };
    const homeWon = home.value > away.value;
    return { result: homeWon === homeIsWhite ? "1-0" : "0-1", forfeit, decided: true };
}

/** True when nothing about this match is known yet — no line-up, no scores. */
export function isMatchUnplayed(match: XmlMatch): boolean {
    return match.boards.every(
        (b) => b.homeDesk === 0 && b.awayDesk === 0 && b.home.value === 0 && b.away.value === 0,
    );
}

export type EloSource = "fide" | "cze";

export type SkeletonOptions = {
    /** Which rating the roster snapshot contributes to `WhiteElo`/`BlackElo`. */
    eloSource: EloSource;
    /** Venue per **home** team number → the `Site` tag. Missing ⇒ empty Site. */
    siteByTeamNo?: Record<number, string>;
    /** Overrides the `Event` tag; defaults to the full competition name. */
    eventName?: string;
};

export type SkeletonGame = {
    key: GameKey;
    tags: PgnTags;
};

/** Tag order of the internal full format. Anything absent is simply skipped. */
const FULL_TAG_ORDER = [
    "Event",
    "Site",
    "Date",
    "Round",
    "White",
    "Black",
    "Result",
    "WhiteTeam",
    "BlackTeam",
    "WhiteElo",
    "BlackElo",
    "WhiteCzeId",
    "BlackCzeId",
    "Board",
    "EventDate",
    "Termination",
    "RatedResult",
];

function tagsFrom(values: Record<string, string | undefined>): PgnTags {
    const order: string[] = [];
    const map: Record<string, string> = {};
    for (const name of FULL_TAG_ORDER) {
        const v = values[name];
        if (v === undefined) continue;
        order.push(name);
        map[name] = v;
    }
    return { order, map };
}

/** ISO `2025-10-12` → PGN `2025.10.12`; anything else is passed through. */
export function toPgnDate(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
    return m ? `${m[1]}.${m[2]}.${m[3]}` : (iso ?? "").trim();
}

function eloOf(entry: RosterEntry | undefined, source: EloSource): string | undefined {
    const elo = source === "cze" ? entry?.czeElo : entry?.fideElo;
    return elo && elo > 0 ? String(elo) : undefined;
}

/** Build the full-format skeleton for a whole competition, ordered (round, match, board). */
export function buildSkeleton(comp: Competition, opts: SkeletonOptions): SkeletonGame[] {
    const roster = indexRoster(comp.roster);
    const teamName = new Map(comp.teams.map((t) => [t.no, t.name]));
    const event = opts.eventName ?? comp.info.name;
    const eventDate = toPgnDate(comp.rounds[0]?.date);

    const games: SkeletonGame[] = [];
    for (const round of comp.rounds) {
        const date = toPgnDate(round.date);
        for (const match of round.matches) {
            const unplayed = isMatchUnplayed(match);
            const home = teamName.get(match.homeTeamNo) ?? `#${match.homeTeamNo}`;
            const away = teamName.get(match.awayTeamNo) ?? `#${match.awayTeamNo}`;
            for (const board of match.boards) {
                games.push(
                    buildBoardGame({
                        match,
                        board,
                        unplayed,
                        homeTeamName: home,
                        awayTeamName: away,
                        date,
                        eventDate,
                        event,
                        roster,
                        opts,
                    }),
                );
            }
        }
    }
    return games;
}

function buildBoardGame(input: {
    match: XmlMatch;
    board: XmlBoard;
    unplayed: boolean;
    homeTeamName: string;
    awayTeamName: string;
    date: string;
    eventDate: string;
    event: string;
    roster: Map<string, RosterEntry>;
    opts: SkeletonOptions;
}): SkeletonGame {
    const { match, board, roster, opts } = input;
    // Odd boards: the home team has White. Verified on every game of the reference
    // tournament against Swiss-Manager's own PGN.
    const homeIsWhite = board.boardNr % 2 === 1;

    const homePlayer = roster.get(rosterKey(match.homeTeamNo, board.homeDesk));
    const awayPlayer = roster.get(rosterKey(match.awayTeamNo, board.awayDesk));

    // A match nobody has been fielded for yet gets recognizable placeholders (as in
    // pgn-base); a single missing player inside a played match is a no-show, "?".
    const homeName = homePlayer
        ? toPgnName(homePlayer.rawName)
        : input.unplayed
          ? `Domácí ${board.boardNr}`
          : "?";
    const awayName = awayPlayer
        ? toPgnName(awayPlayer.rawName)
        : input.unplayed
          ? `Hosté ${board.boardNr}`
          : "?";

    const outcome = boardOutcome(board.home, board.away, homeIsWhite);
    // `sct` = the result the game actually finished with, when the point is awarded
    // by forfeit anyway. Kept as a tag (not a comment) so it survives the movetext
    // being replaced once the captain's moves arrive.
    const rated =
        board.homeRated && board.awayRated
            ? boardOutcome(board.homeRated, board.awayRated, homeIsWhite)
            : null;

    const values: Record<string, string | undefined> = {
        Event: input.event,
        Site: opts.siteByTeamNo?.[match.homeTeamNo] ?? "",
        Date: input.date,
        Round: formatRoundTag({
            roundNr: match.roundNr,
            matchNr: match.matchNr,
            boardNr: board.boardNr,
        }),
        White: homeIsWhite ? homeName : awayName,
        Black: homeIsWhite ? awayName : homeName,
        Result: outcome.result,
        WhiteTeam: homeIsWhite ? input.homeTeamName : input.awayTeamName,
        BlackTeam: homeIsWhite ? input.awayTeamName : input.homeTeamName,
        WhiteElo: eloOf(homeIsWhite ? homePlayer : awayPlayer, opts.eloSource),
        BlackElo: eloOf(homeIsWhite ? awayPlayer : homePlayer, opts.eloSource),
        WhiteCzeId: (homeIsWhite ? homePlayer : awayPlayer)?.czeId || undefined,
        BlackCzeId: (homeIsWhite ? awayPlayer : homePlayer)?.czeId || undefined,
        Board: String(board.boardNr),
        EventDate: input.eventDate || undefined,
        Termination: outcome.forfeit ? "forfeit" : undefined,
        RatedResult: rated && rated.result !== outcome.result ? rated.result : undefined,
    };

    return {
        key: {
            roundNr: match.roundNr,
            matchNr: match.matchNr,
            boardNr: board.boardNr,
        },
        tags: tagsFrom(values),
    };
}

/** Serialize the skeleton into one multi-game PGN file (movetext = the result token). */
export function skeletonToPgn(games: SkeletonGame[]): string {
    return games.map((g) => serializeGame(g.tags, g.tags.map.Result ?? "*")).join("\n\n\n") + "\n";
}

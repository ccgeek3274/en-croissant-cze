// Pure logic for the api.chess.cz (ŠSČR) integration.
// Ported from the pgn-base project (frontend/src/lib/chesscz.ts) and adapted for
// en-croissant: diacritics are kept (the app is fully UTF-8), not stripped.

export const DEFAULT_BOARD_COUNT = 8;

export type ChessczMember = {
    fullName?: string;
    gender?: "M" | "F";
    birthYear?: number;
    playerClass?: string | null;
    czeId?: number;
    czeStdElo?: number;
    czeRapidElo?: number;
    fideId?: number;
    fideStdElo?: number;
    fideRapidElo?: number;
    fideBlitzElo?: number;
    clubName?: string;
    clubId?: string;
};

export type ChessczCompetitionSummary = {
    compName: string;
    compId: number;
    compLevel?: number;
    compSeason?: number;
    compYoungOrAdult?: "A" | "Y";
};

export type ChessczCompetitionRegion = {
    regionCode: string;
    regionName: string;
    competitions: ChessczCompetitionSummary[];
};

export type ChessczCompetitionsByRegion = Record<string, ChessczCompetitionRegion>;

export type ChessczMatchPairing = {
    roundNr: number;
    roundDate: string;
    homeTeamId: number;
    homeTeamName: string;
    homeTeamScore: number | null;
    awayTeamId: number;
    awayTeamName: string;
    awayTeamScore: number | null;
};

export type ChessczRoundSchedule = {
    roundNr: number;
    roundDate: string;
    roundMatches: ChessczMatchPairing[];
};

export type ChessczBoardGame = {
    homePlayerId: number;
    homePlayerName: string;
    homePlayerRating: number;
    homePlayerResult: number;
    awayPlayerId: number;
    awayPlayerName: string;
    awayPlayerRating: number;
    awayPlayerResult: number;
    gameForfeited: number;
};

export type ChessczMatchResult = {
    roundNr: number;
    homeTeamId: number;
    homeTeamName: string;
    homeTeamScore: number;
    awayTeamId: number;
    awayTeamName: string;
    awayTeamScore: number;
    matchGames: ChessczBoardGame[];
};

export type ChessczCompetitionDetails = {
    compName?: string;
    regionName?: string;
};

export type ChessczTeamRow = {
    teamId: number;
    teamName: string;
};

export type PgnHeaders = Record<string, string>;

export type ScaffoldGame = { headers: PgnHeaders; movesPgn: string };

/** chess.cz returns either a single object or an array depending on result count. */
export function asArray<T>(data: T | T[] | null | undefined): T[] {
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
}

/** Some chess.cz endpoints wrap the payload in `{ data: … }`, others return it raw. */
export function unwrapData(data: unknown): unknown {
    if (data && typeof data === "object" && "data" in data) {
        return (data as { data: unknown }).data;
    }
    return data;
}

/** chess.cz mixes number/string types across endpoints — coerce numeric fields. */
export function normalizePairing(e: ChessczMatchPairing): ChessczMatchPairing {
    return {
        ...e,
        roundNr: Number(e.roundNr),
        homeTeamId: Number(e.homeTeamId),
        awayTeamId: Number(e.awayTeamId),
        homeTeamScore: e.homeTeamScore != null ? Number(e.homeTeamScore) : null,
        awayTeamScore: e.awayTeamScore != null ? Number(e.awayTeamScore) : null,
    };
}

/** Normalize a raw chess.cz /schedule payload into rounds with usable pairings.
 *
 * chess.cz nests `roundMatches` **without their own `roundNr`/`roundDate`** — those live
 * only on the parent round. Inject them into each pairing before `normalizePairing`, or
 * the missing `roundNr` becomes `NaN` and `isPlayablePairing`'s `roundNr > 0` check drops
 * every match (the round's match list shows up empty). See pgn-base 71d92c4. */
export function normalizeSchedule(raw: unknown): ChessczRoundSchedule[] {
    return asArray(raw as ChessczRoundSchedule | ChessczRoundSchedule[]).map((r) => {
        const roundNr = Number(r.roundNr);
        return {
            ...r,
            roundNr,
            roundMatches: asArray(r.roundMatches).map((m) =>
                normalizePairing({ ...m, roundNr, roundDate: r.roundDate }),
            ),
        };
    });
}

/** Bye rounds (volno) have no opponent — they can't be imported as a match. */
export function isPlayablePairing(e: ChessczMatchPairing): boolean {
    return (
        Number.isFinite(e.homeTeamId) &&
        e.homeTeamId > 0 &&
        Number.isFinite(e.awayTeamId) &&
        e.awayTeamId > 0 &&
        Number.isFinite(e.roundNr) &&
        e.roundNr > 0
    );
}

const clean = (s: string | null | undefined): string => (s ?? "").trim();

// chess.cz returns names as "Surname Given…" (surname first, no comma). Insert a
// comma after the surname to get the PGN "Surname, Given" form. Only the first
// whitespace token is treated as the surname — correct for the vast majority of
// Czech names; multi-word surnames are the known exception.
export function toPgnPlayerName(fullName: string | null | undefined): string {
    const cleaned = clean(fullName).replace(/\s+/g, " ");
    const sp = cleaned.indexOf(" ");
    if (sp < 0) return cleaned; // single token — nothing to split
    return `${cleaned.slice(0, sp)}, ${cleaned.slice(sp + 1)}`;
}

// Match score "4:4" / "1.5:6.5" / "?:?" (when not yet played).
export function formatMatchScore(
    home: number | null | undefined,
    away: number | null | undefined,
): string {
    if (home == null || away == null) return "?:?";
    if (home + away <= 0) return "?:?";
    return `${formatHalf(home)}:${formatHalf(away)}`;
}

function formatHalf(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace(/\.0$/, "");
}

// DD.MM.YYYY → YYYY.MM.DD (PGN). Returns input unchanged if format unrecognized.
export function formatChessczDate(czDate: string | null | undefined): string {
    if (!czDate) return "";
    const m = czDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return czDate;
    return `${m[3]}.${m[2]}.${m[1]}`;
}

type PlaceholderInput = {
    // Pre-composed Event tag ("<prefix> <home>-<away>", or the full competition name
    // as a fallback) — the same value for every board of the match.
    event: string;
    roundNr: number;
    roundDate: string;
    homeTeamName: string;
    awayTeamName: string;
    boardCount: number;
};

// Build N placeholder games (team-name placeholders) for a not-yet-played round.
export function buildPlaceholderGames(input: PlaceholderInput): ScaffoldGame[] {
    const event = clean(input.event);
    const date = formatChessczDate(input.roundDate);
    const home = clean(input.homeTeamName);
    const away = clean(input.awayTeamName);

    const games: ScaffoldGame[] = [];
    for (let board = 1; board <= input.boardCount; board++) {
        const homeIsWhite = board % 2 === 1;
        games.push({
            headers: {
                Event: event,
                Site: "chess.cz",
                Date: date,
                Round: `${input.roundNr}.${board}`,
                Board: String(board),
                // Player names are unknown until results are published — a recognizable
                // placeholder beats a misleading team name in the player field.
                White: homeIsWhite ? `Domácí ${board}` : `Hosté ${board}`,
                Black: homeIsWhite ? `Hosté ${board}` : `Domácí ${board}`,
                WhiteTeam: homeIsWhite ? home : away,
                BlackTeam: homeIsWhite ? away : home,
                Result: "*",
            },
            movesPgn: "",
        });
    }
    return games;
}

// Map a single played BoardGame (board = idx + 1) to PGN headers.
export function boardGameToHeaders(
    match: ChessczMatchResult,
    game: ChessczBoardGame,
    idx: number,
    event: string,
    roundDate?: string,
): PgnHeaders {
    const board = idx + 1;
    const homeIsWhite = board % 2 === 1;

    const whiteName = homeIsWhite ? game.homePlayerName : game.awayPlayerName;
    const blackName = homeIsWhite ? game.awayPlayerName : game.homePlayerName;
    const whiteElo = homeIsWhite ? game.homePlayerRating : game.awayPlayerRating;
    const blackElo = homeIsWhite ? game.awayPlayerRating : game.homePlayerRating;
    const whiteTeam = homeIsWhite ? match.homeTeamName : match.awayTeamName;
    const blackTeam = homeIsWhite ? match.awayTeamName : match.homeTeamName;
    const whiteCzeId = homeIsWhite ? game.homePlayerId : game.awayPlayerId;
    const blackCzeId = homeIsWhite ? game.awayPlayerId : game.homePlayerId;

    const homeResult = game.homePlayerResult;
    const awayResult = game.awayPlayerResult;

    let result = "*";
    if (homeResult === 1 && awayResult === 0) result = homeIsWhite ? "1-0" : "0-1";
    else if (homeResult === 0 && awayResult === 1) result = homeIsWhite ? "0-1" : "1-0";
    else if (homeResult === 0.5 && awayResult === 0.5) result = "1/2-1/2";

    const headers: PgnHeaders = {
        Event: clean(event),
        Site: "chess.cz",
        Round: `${match.roundNr}.${board}`,
        Board: String(board),
        White: toPgnPlayerName(whiteName),
        Black: toPgnPlayerName(blackName),
        WhiteTeam: clean(whiteTeam),
        BlackTeam: clean(blackTeam),
        Result: result,
    };
    if (roundDate) headers.Date = formatChessczDate(roundDate);
    if (whiteElo) headers.WhiteElo = String(whiteElo);
    if (blackElo) headers.BlackElo = String(blackElo);
    if (whiteCzeId) headers.WhiteCzeId = String(whiteCzeId);
    if (blackCzeId) headers.BlackCzeId = String(blackCzeId);
    if (game.gameForfeited === 1) headers.Termination = "forfeit";
    return headers;
}

// Find the match that pairs the given home/away teams in a round's matches list.
export function findMatch(
    matches: ChessczMatchResult[],
    homeTeamId: number,
    awayTeamId: number,
): ChessczMatchResult | null {
    return matches.find((m) => m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ?? null;
}

const PGN_TAG_ORDER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];

function escapeTag(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Serialize one scaffold game to a PGN block (Seven Tag Roster first, then extras).
function gameToPgn(game: ScaffoldGame): string {
    const { headers } = game;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const tag of PGN_TAG_ORDER) {
        const val = headers[tag] ?? (tag === "Result" ? "*" : "?");
        lines.push(`[${tag} "${escapeTag(val)}"]`);
        seen.add(tag);
    }
    for (const [tag, val] of Object.entries(headers)) {
        if (seen.has(tag) || val === "" || val == null) continue;
        lines.push(`[${tag} "${escapeTag(val)}"]`);
    }
    const moves = game.movesPgn.trim();
    const body = moves ? `${moves} ${headers.Result ?? "*"}` : (headers.Result ?? "*");
    return `${lines.join("\n")}\n\n${body}`;
}

/** Serialize a list of scaffold games into a single multi-game PGN string. */
export function gamesToPgn(games: ScaffoldGame[]): string {
    return games.map(gameToPgn).join("\n\n\n") + "\n";
}

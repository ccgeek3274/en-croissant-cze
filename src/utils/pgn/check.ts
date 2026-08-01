// pgncheck — a database-agnostic "Kontrola" report over a list of PGN games.
//
// Pure logic (no chessops, no I/O): it splits each game into tags + movetext with
// the helpers in this folder and produces a set of typed "cards", each describing
// one class of problem. The report is language-neutral — every card carries
// structured per-game data, so the UI formats the human-readable notes with i18n.
// Faithfully ported from pgn-base's HeaderAuditDialog checks, re-expressed on
// en-croissant's PgnTags and on text-based movetext utilities (no move tree).
//
// Fix helpers (stripGameDiacritics / syncGameResult / setGameTag) live here too so
// the card actions stay pure and unit-testable; movetext cleanup uses buildExportGame
// (export.ts) and variation removal uses stripVariationsKeepMainLine (cleanup.ts).

import {
    type ArtifactCounts,
    countArtifacts,
    hasAnyTopLevelVariation,
    hasArtifacts,
    removeDiacritics,
    stripVariationsKeepMainLine,
    syncMovetextResult,
    type VariationInfo,
    variationInfo,
} from "./cleanup";
import { getTag, type ParsedGame, serializeGame, splitGame } from "./tags";

/** ok = nothing to flag; warn = something the user should look at; unknown =
 *  the check could not run (e.g. no games, or a match-only check off a plain file). */
export type CheckStatus = "ok" | "warn" | "unknown";

export type CheckId =
    | "artifacts"
    | "variations"
    | "diacritics"
    | "result"
    | "event"
    | "teams"
    | "duplicates";

/** Enough to identify a game in the affected-games list without re-reading it. */
export type GameRef = {
    /** 0-based index of the game in the file. */
    index: number;
    white: string;
    black: string;
    round: string;
    board: string;
};

export type ArtifactsCard = {
    id: "artifacts";
    status: CheckStatus;
    affected: number;
    /** Column totals across the cleanable (variation-free) games. */
    totals: ArtifactCounts;
    games: (GameRef & { counts: ArtifactCounts })[];
};

export type VariationsCard = {
    id: "variations";
    status: CheckStatus;
    affected: number;
    /** Games carrying variations — removed one at a time, never in bulk. */
    games: (GameRef & { info: VariationInfo })[];
};

export type DiacriticsChange = { tag: string; from: string; to: string };
export type DiacriticsCard = {
    id: "diacritics";
    status: CheckStatus;
    affected: number;
    games: (GameRef & { changes: DiacriticsChange[] })[];
};

export type ResultCard = {
    id: "result";
    status: CheckStatus;
    affected: number;
    /** header = the Result tag, movetext = the trailing terminator (null if none). */
    games: (GameRef & { header: string; movetext: string | null })[];
};

export type EventCard = {
    id: "event";
    status: CheckStatus;
    /** True when exactly one non-empty Event value spans every game. */
    uniform: boolean;
    values: string[];
};

export type TeamsCard = {
    id: "teams";
    status: CheckStatus;
    /** False when no game has both a board number and both team names. */
    checkable: boolean;
    /** The dominant team on white for odd / even boards (drives the expectation). */
    teamOdd: string | null;
    teamEven: string | null;
    violations: GameRef[];
    /** Games skipped because they lack a board number or a team name. */
    missingInfo: number;
};

export type DuplicatesCard = {
    id: "duplicates";
    status: CheckStatus;
    affected: number;
    /** Each group is two-or-more games that share the same normalized pairing. */
    groups: { key: string; games: GameRef[] }[];
};

export type CheckCard =
    | ArtifactsCard
    | VariationsCard
    | DiacriticsCard
    | ResultCard
    | EventCard
    | TeamsCard
    | DuplicatesCard;

export type PgnCheckReport = {
    total: number;
    cards: CheckCard[];
    /** True when no card has status "warn". */
    clean: boolean;
};

export type PgnCheckOptions = {
    /** Enable the match-only checks (uniform Event + team alternation). */
    isMatch?: boolean;
};

/** Header tags scanned for (and stripped of) diacritics — same set pgn-base used. */
export const DIACRITIC_FIELDS = ["Event", "Site", "White", "Black", "WhiteTeam", "BlackTeam"];

/** The tags the "Tagy" editor lists. `replaceable` tags can be bulk-unified;
 *  names/Elo are list-only on purpose (unifying two real players is unrecoverable). */
export const TAG_DEFS: { key: string; replaceable: boolean }[] = [
    { key: "Event", replaceable: true },
    { key: "Site", replaceable: true },
    { key: "Date", replaceable: true },
    { key: "Round", replaceable: true },
    { key: "Board", replaceable: true },
    { key: "Result", replaceable: true },
    { key: "WhiteTeam", replaceable: true },
    { key: "BlackTeam", replaceable: true },
    { key: "ECO", replaceable: true },
    { key: "White", replaceable: false },
    { key: "Black", replaceable: false },
    { key: "WhiteElo", replaceable: false },
    { key: "BlackElo", replaceable: false },
];

const RESULT_TERMINATOR_RE = /(1-0|0-1|1\/2-1\/2|\*)\s*$/;

/** The last result terminator token in a movetext, or null if there is none. */
export function movetextResult(movetext: string): string | null {
    const m = movetext.trimEnd().match(RESULT_TERMINATOR_RE);
    return m ? m[1] : null;
}

/** A tag value that is empty or a bare placeholder ("?", "*", "????.??.??"). */
export function isPlaceholder(value: string): boolean {
    const v = value.trim();
    return v === "" || v === "?" || v === "*" || v === "????.??.??";
}

function boardOf(tags: ParsedGame["tags"], round: string): string {
    return getTag(tags, "Board") ?? (round.includes(".") ? round.split(".")[1] : "");
}

function gameRef(index: number, tags: ParsedGame["tags"]): GameRef {
    const round = getTag(tags, "Round") ?? "";
    return {
        index,
        white: getTag(tags, "White") ?? "",
        black: getTag(tags, "Black") ?? "",
        round,
        board: boardOf(tags, round),
    };
}

function emptyCounts(): ArtifactCounts {
    return { comments: 0, variations: 0, nags: 0, glyphs: 0, escapes: 0 };
}

/** The distinct-value → count breakdown a "Tagy" tab shows for one tag. */
export type TagValue = { value: string; count: number; indices: number[]; suspicious: boolean };

/** Distinct values of `tag` across `games`, with counts, game indices and a
 *  placeholder flag, most-common first (ties broken alphabetically, cs collation). */
export function distinctTagValues(games: string[], tag: string): TagValue[] {
    const map = new Map<string, number[]>();
    games.forEach((g, i) => {
        const v = (getTag(splitGame(g).tags, tag) ?? "").trim();
        (map.get(v) ?? map.set(v, []).get(v)!).push(i);
    });
    return [...map.entries()]
        .map(([value, indices]) => ({
            value,
            indices,
            count: indices.length,
            suspicious: isPlaceholder(value),
        }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "cs"));
}

/**
 * Run every check over `games` (raw PGN blocks) and return the report.
 *
 * A single pass splits each game once; the per-check accumulators are then folded
 * into typed cards. `status` is "unknown" only when a check cannot run.
 */
export function pgncheck(games: string[], opts: PgnCheckOptions = {}): PgnCheckReport {
    const parsed = games.map((g) => splitGame(g));
    const refs = parsed.map((p, i) => gameRef(i, p.tags));
    const has = games.length > 0;

    // 1./2. Removable annotations vs. variations. A game with variations is handled
    //       only through per-game variation removal (never bulk-cleaned), exactly
    //       like pgn-base: bulk cleanup on it would silently drop the variations.
    const artifactTotals = emptyCounts();
    const artifactGames: (GameRef & { counts: ArtifactCounts })[] = [];
    const variationGames: (GameRef & { info: VariationInfo })[] = [];
    parsed.forEach((p, i) => {
        if (hasAnyTopLevelVariation(p.movetext)) {
            variationGames.push({ ...refs[i], info: variationInfo(p.movetext) });
            return;
        }
        const c = countArtifacts(p.movetext);
        artifactTotals.comments += c.comments;
        artifactTotals.nags += c.nags;
        artifactTotals.glyphs += c.glyphs;
        artifactTotals.escapes += c.escapes;
        if (hasArtifacts(c)) artifactGames.push({ ...refs[i], counts: c });
    });

    // 3. Diacritics in header tags.
    const diacriticsGames: (GameRef & { changes: DiacriticsChange[] })[] = [];
    parsed.forEach((p, i) => {
        const changes: DiacriticsChange[] = [];
        for (const tag of DIACRITIC_FIELDS) {
            const from = getTag(p.tags, tag);
            if (from == null || from === "") continue;
            const to = removeDiacritics(from);
            if (to !== from) changes.push({ tag, from, to });
        }
        if (changes.length > 0) diacriticsGames.push({ ...refs[i], changes });
    });

    // 4. Result header vs. movetext terminator. Flag only when a decisive header
    //    Result disagrees with a present terminator, or has none while the game
    //    actually has moves.
    const resultGames: (GameRef & { header: string; movetext: string | null })[] = [];
    parsed.forEach((p, i) => {
        const header = (getTag(p.tags, "Result") ?? "").trim();
        if (header === "" || header === "*") return;
        const term = movetextResult(p.movetext);
        const hasMoves = p.movetext.trim() !== "";
        if (term === header) return;
        if (term == null && !hasMoves) return;
        resultGames.push({ ...refs[i], header, movetext: term });
    });

    // 5. Duplicate pairings (same players + round + board, diacritics-insensitive).
    const norm = (s: string) => removeDiacritics(s).toLowerCase().trim();
    const buckets = new Map<string, GameRef[]>();
    refs.forEach((r) => {
        if (norm(r.white) === "" && norm(r.black) === "") return;
        const key = [norm(r.white), norm(r.black), norm(r.round), norm(r.board)].join("|");
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
    });
    const dupGroups = [...buckets.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([key, list]) => ({ key, games: list }));
    const dupAffected = dupGroups.reduce((n, g) => n + g.games.length, 0);

    const status = (affected: number): CheckStatus =>
        !has ? "unknown" : affected > 0 ? "warn" : "ok";

    const cards: CheckCard[] = [
        {
            id: "artifacts",
            status: status(artifactGames.length),
            affected: artifactGames.length,
            totals: artifactTotals,
            games: artifactGames,
        },
        {
            id: "variations",
            status: status(variationGames.length),
            affected: variationGames.length,
            games: variationGames,
        },
        {
            id: "diacritics",
            status: status(diacriticsGames.length),
            affected: diacriticsGames.length,
            games: diacriticsGames,
        },
        {
            id: "result",
            status: status(resultGames.length),
            affected: resultGames.length,
            games: resultGames,
        },
    ];

    // 6./7. Match-only checks — meaningless across a plain, single-game-per-pairing DB.
    if (opts.isMatch && has) {
        cards.push(eventCard(parsed), teamsCard(parsed, refs));
    }

    cards.push({
        id: "duplicates",
        status: status(dupAffected),
        affected: dupAffected,
        groups: dupGroups,
    });

    return {
        total: games.length,
        cards,
        clean: cards.every((c) => c.status !== "warn"),
    };
}

/** Uniform-Event check: one non-empty Event value across every game. */
function eventCard(parsed: ParsedGame[]): EventCard {
    const values = [...new Set(parsed.map((p) => (getTag(p.tags, "Event") ?? "").trim()))];
    const uniform = values.length === 1 && values[0] !== "";
    return { id: "event", status: uniform ? "ok" : "warn", uniform, values };
}

/** Team-alternation check: odd boards have one team on white, even boards the other.
 *  The dominant white team per board parity sets the expectation; games that break
 *  it are flagged. Ported from pgn-base's matchChecks. */
function teamsCard(parsed: ParsedGame[], refs: GameRef[]): TeamsCard {
    const oddWhite = new Map<string, number>();
    const evenWhite = new Map<string, number>();
    const checkable: { ref: GameRef; board: number; wt: string; bt: string }[] = [];
    let missingInfo = 0;

    parsed.forEach((p, i) => {
        const board = Number.parseInt(refs[i].board.trim(), 10);
        const wt = (getTag(p.tags, "WhiteTeam") ?? "").trim();
        const bt = (getTag(p.tags, "BlackTeam") ?? "").trim();
        if (!Number.isFinite(board) || board <= 0 || !wt || !bt) {
            missingInfo++;
            return;
        }
        checkable.push({ ref: refs[i], board, wt, bt });
        const m = board % 2 === 1 ? oddWhite : evenWhite;
        m.set(wt, (m.get(wt) ?? 0) + 1);
    });

    const top = (m: Map<string, number>) =>
        [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const teamOdd = top(oddWhite);
    const teamEven = top(evenWhite);

    const violations: GameRef[] = [];
    for (const { ref, board, wt, bt } of checkable) {
        const expWhite = board % 2 === 1 ? teamOdd : teamEven;
        const expBlack = board % 2 === 1 ? teamEven : teamOdd;
        if ((expWhite && wt !== expWhite) || (expBlack && bt !== expBlack)) violations.push(ref);
    }

    return {
        id: "teams",
        status: checkable.length === 0 ? "unknown" : violations.length > 0 ? "warn" : "ok",
        checkable: checkable.length > 0,
        teamOdd,
        teamEven,
        violations,
        missingInfo,
    };
}

// ————————————————————————————————————————————————————————————————
// Fix helpers (pure) — drive the per-card / per-tag actions.

/** Strip diacritics from the given header tags, leaving movetext untouched. */
export function stripGameDiacritics(gameText: string, fields = DIACRITIC_FIELDS): string {
    const { tags, movetext } = splitGame(gameText);
    for (const f of fields) {
        const v = tags.map[f];
        if (v) tags.map[f] = removeDiacritics(v);
    }
    return serializeGame(tags, movetext);
}

/** Rewrite the movetext terminator so it matches the game's Result header. A
 *  missing or "*" Result is left alone (nothing authoritative to sync to). */
export function syncGameResult(gameText: string): string {
    const { tags, movetext } = splitGame(gameText);
    const result = (tags.map.Result ?? "").trim();
    if (result === "" || result === "*") return serializeGame(tags, movetext);
    return serializeGame(tags, syncMovetextResult(movetext, result));
}

/** Set a header tag on a game (adding it if absent). Setting Result also syncs the
 *  movetext terminator so the two never drift apart. */
export function setGameTag(gameText: string, tag: string, value: string): string {
    const { tags, movetext } = splitGame(gameText);
    if (!(tag in tags.map)) tags.order.push(tag);
    tags.map[tag] = value;
    const moves = tag === "Result" ? syncMovetextResult(movetext, value || "*") : movetext;
    return serializeGame(tags, moves);
}

/** Remove every variation from a game, keeping its main line (comments/NAGs/glyphs
 *  survive) and syncing the terminator to the Result header. */
export function removeGameVariations(gameText: string): string {
    const { tags, movetext } = splitGame(gameText);
    return serializeGame(tags, stripVariationsKeepMainLine(movetext, tags.map.Result ?? "*"));
}

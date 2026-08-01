// pgncheck — a database-agnostic "Kontrola" report over a list of PGN games.
//
// Pure logic (no chessops, no I/O): it splits each game into tags + movetext with
// the helpers in this folder and produces a set of typed "cards", each describing
// one class of problem (removable annotations, diacritics in headers, Result vs.
// movetext-terminator mismatch, missing/placeholder tags, duplicate pairings).
// The report is language-neutral — every card carries structured per-game data, so
// the UI formats the human-readable notes with i18n. Modeled after pgn-base's
// HeaderAuditDialog checks, re-expressed on en-croissant's PgnTags.
//
// Fix helpers (stripGameDiacritics / syncGameResult) live here too so the card
// actions are pure and unit-testable; movetext cleanup already lives in export.ts
// (buildExportGame).

import {
    type ArtifactCounts,
    countArtifacts,
    hasArtifacts,
    removeDiacritics,
    syncMovetextResult,
} from "./cleanup";
import { getTag, serializeGame, splitGame } from "./tags";

/** ok = nothing to flag; warn = something the user should look at; unknown =
 *  the check could not run (e.g. no games). */
export type CheckStatus = "ok" | "warn" | "unknown";

export type CheckId = "artifacts" | "diacritics" | "result" | "tags" | "duplicates";

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
    /** Column totals across all games (drives the per-class checkboxes). */
    totals: ArtifactCounts;
    games: (GameRef & { counts: ArtifactCounts })[];
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

export type TagsCard = {
    id: "tags";
    status: CheckStatus;
    affected: number;
    games: (GameRef & { missing: string[] })[];
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
    | DiacriticsCard
    | ResultCard
    | TagsCard
    | DuplicatesCard;

export type PgnCheckReport = {
    total: number;
    cards: CheckCard[];
    /** True when no card has status "warn". */
    clean: boolean;
};

/** Header tags scanned for (and stripped of) diacritics — same set pgn-base used. */
export const DIACRITIC_FIELDS = ["Event", "Site", "White", "Black", "WhiteTeam", "BlackTeam"];

/** Tags a well-formed game is expected to carry a real value for. */
export const REQUIRED_TAGS = ["Event", "Date", "White", "Black", "Result"];

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

function gameRef(index: number, tags: ReturnType<typeof splitGame>["tags"]): GameRef {
    const round = getTag(tags, "Round") ?? "";
    return {
        index,
        white: getTag(tags, "White") ?? "",
        black: getTag(tags, "Black") ?? "",
        round,
        board: getTag(tags, "Board") ?? (round.includes(".") ? round.split(".")[1] : ""),
    };
}

function emptyCounts(): ArtifactCounts {
    return { comments: 0, variations: 0, nags: 0, glyphs: 0, escapes: 0 };
}

/**
 * Run every check over `games` (raw PGN blocks) and return the report.
 *
 * A single pass splits each game once; the per-check accumulators are then folded
 * into typed cards. `status` is "unknown" only when there are no games to inspect.
 */
export function pgncheck(games: string[]): PgnCheckReport {
    const parsed = games.map((g) => splitGame(g));
    const refs = parsed.map((p, i) => gameRef(i, p.tags));
    const has = games.length > 0;

    // 1. Removable movetext annotations (comments / variations / NAGs / glyphs / escapes).
    const artifactTotals = emptyCounts();
    const artifactGames: (GameRef & { counts: ArtifactCounts })[] = [];
    parsed.forEach((p, i) => {
        const c = countArtifacts(p.movetext);
        artifactTotals.comments += c.comments;
        artifactTotals.variations += c.variations;
        artifactTotals.nags += c.nags;
        artifactTotals.glyphs += c.glyphs;
        artifactTotals.escapes += c.escapes;
        if (hasArtifacts(c)) artifactGames.push({ ...refs[i], counts: c });
    });

    // 2. Diacritics in header tags.
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

    // 3. Result header vs. movetext terminator. Flag only when a decisive header
    //    Result disagrees with a present terminator, or a decisive header Result
    //    has no terminator at all while the game actually has moves.
    const resultGames: (GameRef & { header: string; movetext: string | null })[] = [];
    parsed.forEach((p, i) => {
        const header = (getTag(p.tags, "Result") ?? "").trim();
        if (header === "" || header === "*") return;
        const term = movetextResult(p.movetext);
        const hasMoves = p.movetext.trim() !== "";
        if (term === header) return;
        if (term == null && !hasMoves) return; // empty scaffold — nothing to sync yet
        resultGames.push({ ...refs[i], header, movetext: term });
    });

    // 4. Missing / placeholder required tags.
    const tagGames: (GameRef & { missing: string[] })[] = [];
    parsed.forEach((p, i) => {
        const missing = REQUIRED_TAGS.filter((tag) => isPlaceholder(getTag(p.tags, tag) ?? ""));
        if (missing.length > 0) tagGames.push({ ...refs[i], missing });
    });

    // 5. Duplicate pairings (same players + round + board, diacritics-insensitive).
    const norm = (s: string) => removeDiacritics(s).toLowerCase().trim();
    const buckets = new Map<string, GameRef[]>();
    refs.forEach((r) => {
        const key = [norm(r.white), norm(r.black), norm(r.round), norm(r.board)].join("|");
        // Skip games with no identifying names — they'd all collapse into one bucket.
        if (norm(r.white) === "" && norm(r.black) === "") return;
        const list = buckets.get(key) ?? [];
        list.push(r);
        buckets.set(key, list);
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
        {
            id: "tags",
            status: status(tagGames.length),
            affected: tagGames.length,
            games: tagGames,
        },
        {
            id: "duplicates",
            status: status(dupAffected),
            affected: dupAffected,
            groups: dupGroups,
        },
    ];

    return {
        total: games.length,
        cards,
        clean: cards.every((c) => c.status !== "warn"),
    };
}

// ————————————————————————————————————————————————————————————————
// Fix helpers (pure) — drive the per-card actions.

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

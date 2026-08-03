// Re-sync a competition PGN against a freshly exported XML.
//
// This runs once per round for a whole season, so its guarantees matter more than
// its cleverness:
//
//   1. **Moves are never lost.** A header change on a game that already carries a
//      captain's moves is a *conflict* the leader decides, never an auto-apply.
//   2. **A regression never overwrites.** Swiss-Manager data lags reality; a round
//      that lost its line-up in the new file means "not known", not "delete".
//   3. **Nothing is deleted.** A game the new XML no longer describes stays in the
//      file, flagged, at the end.
//   4. **`Event` and `Site` are the leader's.** They are the fingerprint of the
//      original import (and of the label directory); re-sync does not touch them —
//      the same rule pgn-base settled on for "Načíst výsledky".
//
// Pure: takes and returns PGN text, does no I/O.

import { isPlaceholder, movetextResult } from "@/utils/pgn/check";
import { syncMovetextResult } from "@/utils/pgn/cleanup";
import { getTag, type PgnTags, serializeGame, splitGame } from "@/utils/pgn/tags";
import {
    formatRoundTag,
    type GameKey,
    gameKeyOrder,
    parseRoundTag,
    type SkeletonGame,
} from "./skeleton";

/** Header tags re-sync owns. Event/Site are deliberately absent (see the note above). */
export const SYNCED_TAGS = [
    "Date",
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

/** Tags whose *absence* is a statement, not a gap: the skeleton emits them exactly
 *  when the XML says so, so a forfeit that was reversed has to clear them again. */
const FLAG_TAGS = new Set(["Termination", "RatedResult"]);

export type SyncRowKind =
    /** Nothing to do. */
    | "unchanged"
    /** The game is not in the file yet (a round added mid-season). */
    | "added"
    /** The file had a placeholder / nothing; the XML now knows. Safe, auto-applied. */
    | "fill"
    /** Real change, but the game carries no moves. Safe, auto-applied. */
    | "update"
    /** Real change on a game that already has moves. The leader decides. */
    | "conflict";

export type SyncFieldChange = {
    tag: string;
    from: string;
    to: string;
};

export type SyncRow = {
    key: GameKey;
    /** "1.1.1" — the game's identity and its label in the report. */
    round: string;
    kind: SyncRowKind;
    /** "White – Black" as the file currently has it (or as the XML proposes, when added). */
    label: string;
    hasMoves: boolean;
    changes: SyncFieldChange[];
};

export type SyncOrphan = {
    /** Index into the input game list. */
    index: number;
    round: string;
    label: string;
};

export type SyncPlan = {
    rows: SyncRow[];
    /** Games the new XML does not describe. Kept as-is, never removed. */
    orphans: SyncOrphan[];
    /** Skeleton games that map to more than one game in the file. */
    duplicates: string[];
    counts: Record<SyncRowKind, number>;
};

// ── helpers ─────────────────────────────────────────────────────────────────

const PLACEHOLDER_NAME_RE = /^(Domácí|Hosté)\s+\d+$/;

/** A value that carries no information: empty, "?", "*", or a scaffold player name. */
export function isUninformative(value: string | undefined): boolean {
    const v = (value ?? "").trim();
    return v === "" || isPlaceholder(v) || PLACEHOLDER_NAME_RE.test(v);
}

/** True when the movetext holds actual moves, not just a result terminator. */
export function hasMoves(movetext: string): boolean {
    const result = movetextResult(movetext);
    const body = (result ? movetext.trimEnd().slice(0, -result.length) : movetext).trim();
    return body !== "";
}

function label(tags: PgnTags): string {
    return `${getTag(tags, "White") || "?"} – ${getTag(tags, "Black") || "?"}`;
}

/** Index the file's games by their three-level Round tag. */
function indexByRound(games: string[]): {
    byRound: Map<string, number>;
    duplicates: string[];
    orphans: SyncOrphan[];
} {
    const byRound = new Map<string, number>();
    const duplicates: string[] = [];
    const orphans: SyncOrphan[] = [];
    games.forEach((text, index) => {
        const { tags } = splitGame(text);
        const round = getTag(tags, "Round") ?? "";
        if (!parseRoundTag(round)) {
            orphans.push({ index, round, label: label(tags) });
            return;
        }
        if (byRound.has(round)) {
            duplicates.push(round);
            orphans.push({ index, round, label: label(tags) });
            return;
        }
        byRound.set(round, index);
    });
    return { byRound, duplicates, orphans };
}

/** What the XML proposes for one tag, given what the file already has.
 *  Returns null when the proposal must be ignored.
 *
 *  `informative` says whether the new skeleton knows anything about this game at
 *  all; a round that regressed to "not drawn up yet" must not clear flag tags. */
function proposeChange(
    tag: string,
    current: string | undefined,
    next: string | undefined,
    informative: boolean,
): SyncFieldChange | null {
    const from = (current ?? "").trim();
    const to = (next ?? "").trim();
    if (from === to) return null;
    if (isUninformative(to) && !isUninformative(from)) {
        // Guard 2: the XML got *less* specific — it does not know, so keep what we
        // have. The exception is a flag the XML is entitled to withdraw.
        if (!(FLAG_TAGS.has(tag) && to === "" && informative)) return null;
    }
    return { tag, from, to };
}

/** Does the new skeleton actually know who is playing this board? */
function isInformative(tags: PgnTags): boolean {
    return !isUninformative(tags.map.White) || !isUninformative(tags.map.Black);
}

// ── plan ────────────────────────────────────────────────────────────────────

/** Compare the file against a freshly built skeleton and classify every game. */
export function planSync(currentGames: string[], skeleton: SkeletonGame[]): SyncPlan {
    const { byRound, duplicates, orphans } = indexByRound(currentGames);
    const claimed = new Set<number>();
    const rows: SyncRow[] = [];

    for (const game of skeleton) {
        const round = formatRoundTag(game.key);
        const index = byRound.get(round);

        if (index === undefined) {
            rows.push({
                key: game.key,
                round,
                kind: "added",
                label: `${game.tags.map.White || "?"} – ${game.tags.map.Black || "?"}`,
                hasMoves: false,
                changes: [],
            });
            continue;
        }
        claimed.add(index);

        const { tags, movetext } = splitGame(currentGames[index]);
        const moves = hasMoves(movetext);

        const informative = isInformative(game.tags);
        const changes: SyncFieldChange[] = [];
        let onlyFills = true;
        for (const tag of SYNCED_TAGS) {
            const change = proposeChange(tag, getTag(tags, tag), game.tags.map[tag], informative);
            if (!change) continue;
            changes.push(change);
            if (!isUninformative(change.from)) onlyFills = false;
        }

        const kind: SyncRowKind =
            changes.length === 0 ? "unchanged" : onlyFills ? "fill" : moves ? "conflict" : "update";

        rows.push({ key: game.key, round, kind, label: label(tags), hasMoves: moves, changes });
    }

    // Anything in the file the skeleton never claimed is an orphan too.
    currentGames.forEach((text, index) => {
        if (claimed.has(index) || orphans.some((o) => o.index === index)) return;
        const { tags } = splitGame(text);
        orphans.push({ index, round: getTag(tags, "Round") ?? "", label: label(tags) });
    });
    orphans.sort((a, b) => a.index - b.index);

    const counts: Record<SyncRowKind, number> = {
        unchanged: 0,
        added: 0,
        fill: 0,
        update: 0,
        conflict: 0,
    };
    for (const r of rows) counts[r.kind]++;

    return { rows, orphans, duplicates, counts };
}

export type ApplyOptions = {
    /** Round tags of conflicts the leader accepted. Everything else stays as it is. */
    acceptedConflicts?: Iterable<string>;
};

/** Apply a plan. Output is ordered (round, match, board), with orphans appended in
 *  their original order so nothing is ever silently dropped. */
export function applySync(
    currentGames: string[],
    skeleton: SkeletonGame[],
    plan: SyncPlan,
    opts: ApplyOptions = {},
): string[] {
    const accepted = new Set(opts.acceptedConflicts ?? []);
    const { byRound } = indexByRound(currentGames);
    const rowByRound = new Map(plan.rows.map((r) => [r.round, r]));

    const ordered = [...skeleton].sort((a, b) => gameKeyOrder(a.key, b.key));
    const out: string[] = [];

    for (const game of ordered) {
        const round = formatRoundTag(game.key);
        const row = rowByRound.get(round);
        const index = byRound.get(round);

        if (index === undefined) {
            out.push(serializeGame(game.tags, game.tags.map.Result ?? "*"));
            continue;
        }

        const { tags, movetext } = splitGame(currentGames[index]);
        const apply = row && (row.kind === "fill" || row.kind === "update" || accepted.has(round));
        if (!apply || !row) {
            out.push(serializeGame(tags, movetext));
            continue;
        }

        const next: PgnTags = { order: [...tags.order], map: { ...tags.map } };
        for (const change of row.changes) {
            if (change.to === "") {
                // A withdrawn flag is removed, not emitted as an empty tag.
                next.order = next.order.filter((t) => t !== change.tag);
                delete next.map[change.tag];
                continue;
            }
            if (!(change.tag in next.map)) next.order.push(change.tag);
            next.map[change.tag] = change.to;
        }
        // The result terminator has to follow the header, or Kontrola flags the game.
        out.push(serializeGame(next, syncMovetextResult(movetext, next.map.Result ?? "*")));
    }

    for (const orphan of plan.orphans) out.push(currentGames[orphan.index]);
    return out;
}

/** Serialize a game list back into a competition .pgn. */
export function gamesToFile(games: string[]): string {
    return games.join("\n\n\n") + "\n";
}

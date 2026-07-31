// Pairing logic for "Importovat partie" — line imported games up against the games
// already in a database and copy their movetext across (e.g. a captain sends the
// board results of a team match as a PGN; we merge them into the existing scaffold).
//
// Pure functions, no I/O and no move validation — movetext is copied as text, in
// keeping with the header-first, text-as-canonical model. Ported from pgn-base
// (frontend/src/lib/mergeImport.ts) and generalized to en-croissant's PgnTags.

import { removeDiacritics, syncMovetextResult } from "./cleanup";
import { getTag, type PgnTags, serializeGame, splitGame } from "./tags";

export type PairSide = {
    white: string;
    black: string;
    round: string;
    board: string;
};

/** Derive the fields used for pairing from a game's tags (Board falls back to the
 *  part after the dot in a "round.board" Round tag). */
export function pairSideFromTags(tags: PgnTags): PairSide {
    const round = getTag(tags, "Round") ?? "";
    const board = getTag(tags, "Board") ?? (round.includes(".") ? round.split(".")[1] : "");
    return {
        white: getTag(tags, "White") ?? "",
        black: getTag(tags, "Black") ?? "",
        round,
        board,
    };
}

function nameTokens(name: string): string[] {
    return removeDiacritics(name || "")
        .toLowerCase()
        .replace(/[.,]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
}

/** 0..1 fuzzy similarity of two player names by shared-token overlap. */
export function nameScore(a: string, b: string): number {
    const ta = nameTokens(a);
    const tb = nameTokens(b);
    if (ta.length === 0 || tb.length === 0) return 0;
    const setB = new Set(tb);
    const shared = ta.filter((t) => setB.has(t)).length;
    return shared / Math.max(ta.length, tb.length);
}

function normToken(s: string | null | undefined): string {
    return (s ?? "").trim();
}

function surname(name: string): string {
    return nameTokens(name)[0] ?? "";
}

/** Classic Levenshtein edit distance (two-row DP). */
function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array<number>(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/** Two surnames "the same" allowing for a typo (equal or small edit distance). */
function surnameSimilar(a: string, b: string): boolean {
    const sa = surname(a);
    const sb = surname(b);
    if (!sa || !sb) return false;
    if (sa === sb) return true;
    const maxLen = Math.max(sa.length, sb.length);
    return levenshtein(sa, sb) <= Math.max(1, Math.floor(maxLen * 0.25));
}

function sideNameScore(a: string, b: string): number {
    const s = nameScore(a, b);
    return surnameSimilar(a, b) ? Math.max(s, 0.9) : s;
}

/** Confidence that a target game and an imported game are the same pairing. */
export function pairScore(target: PairSide, imp: PairSide): number {
    let score = sideNameScore(target.white, imp.white) + sideNameScore(target.black, imp.black);
    const tRound = normToken(target.round);
    const iRound = normToken(imp.round);
    if (tRound && iRound && tRound === iRound) score += 0.5;
    const tBoard = normToken(target.board);
    const iBoard = normToken(imp.board);
    if (tBoard && iBoard && tBoard === iBoard) score += 0.5;
    return score;
}

/** How many of the two surnames match (typo-tolerant): 2 / 1 / 0. */
export function matchLevel(target: PairSide, imp: PairSide): 0 | 1 | 2 {
    const w = surnameSimilar(target.white, imp.white) ? 1 : 0;
    const b = surnameSimilar(target.black, imp.black) ? 1 : 0;
    return (w + b) as 0 | 1 | 2;
}

/**
 * Assign each target its best imported game (permutation of imported indices).
 * Global best-first: every positive-scoring (target, imported) pair is seated
 * strongest-first, each side used once; the remainder is filled positionally.
 * Returns an array `assignment` of length targets.length where assignment[t] is
 * the imported index paired with target t, or -1 if none. `leftovers` lists the
 * imported indices that paired with no target.
 */
export function autoPair(
    targets: PairSide[],
    imported: PairSide[],
): { assignment: number[]; leftovers: number[] } {
    const usedImp = new Set<number>();
    const assignment = new Array<number>(targets.length).fill(-1);

    const pairs: { t: number; j: number; s: number }[] = [];
    for (let t = 0; t < targets.length; t++) {
        for (let j = 0; j < imported.length; j++) {
            const s = pairScore(targets[t], imported[j]);
            if (s > 0) pairs.push({ t, j, s });
        }
    }
    pairs.sort((a, b) => b.s - a.s || a.t - b.t || a.j - b.j);
    for (const { t, j } of pairs) {
        if (assignment[t] !== -1 || usedImp.has(j)) continue;
        assignment[t] = j;
        usedImp.add(j);
    }

    // Fill still-empty targets positionally with unused imported games (in order).
    const leftovers = imported.map((_, j) => j).filter((j) => !usedImp.has(j));
    let li = 0;
    for (let t = 0; t < targets.length && li < leftovers.length; t++) {
        if (assignment[t] === -1) {
            assignment[t] = leftovers[li];
            usedImp.add(leftovers[li]);
            li++;
        }
    }

    return { assignment, leftovers: leftovers.slice(li) };
}

export type MergeRow = {
    /** Index into the target list. */
    target: number;
    /** Index into the imported list, or null if unmatched. */
    imported: number | null;
    /** Surname-match confidence for matched rows (0..2). */
    level: 0 | 1 | 2;
    targetSide: PairSide;
    importedSide: PairSide | null;
};

export type MergePlan = {
    rows: MergeRow[];
    /** Imported games that matched no target (appended on apply). */
    appendedImported: number[];
};

/** Build the pairing plan (for a preview table + apply step). */
export function planMerge(targetGames: string[], importedGames: string[]): MergePlan {
    const targets = targetGames.map((g) => pairSideFromTags(splitGame(g).tags));
    const imported = importedGames.map((g) => pairSideFromTags(splitGame(g).tags));
    const { assignment, leftovers } = autoPair(targets, imported);

    const rows: MergeRow[] = targets.map((targetSide, t) => {
        const j = assignment[t];
        return {
            target: t,
            imported: j === -1 ? null : j,
            level: j === -1 ? 0 : matchLevel(targetSide, imported[j]),
            targetSide,
            importedSide: j === -1 ? null : imported[j],
        };
    });

    return { rows, appendedImported: leftovers };
}

/** Copy the imported movetext into a target game, keeping the target's headers but
 *  adopting the imported game's Result (and syncing the terminator). Returns the
 *  merged game's PGN text. */
export function applyMergedMovetext(targetGame: string, importedGame: string): string {
    const target = splitGame(targetGame);
    const imp = splitGame(importedGame);
    const result = getTag(imp.tags, "Result");
    if (result && result !== "*") target.tags.map.Result = result;
    const moves = syncMovetextResult(imp.movetext, target.tags.map.Result ?? "*");
    return serializeGame(target.tags, moves);
}

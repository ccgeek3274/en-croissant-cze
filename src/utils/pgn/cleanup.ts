// General, database-agnostic PGN movetext cleanup.
//
// These are pure text functions (no chessops, no I/O) so they apply to ANY PGN —
// the ŠSČR import scaffolds, standard databases, or the future competition-leader
// mode — and unit-test cleanly. The management layer treats movetext as text and
// leaves real move editing to en-croissant's analysis tab, so cleaning here is a
// string transform, not a tree operation.
//
// Ported and generalized from pgn-base (frontend/src/lib/pgnUtils.ts). The key
// improvement over that port: variation/comment removal never leaves an orphan
// black move-continuation number ("12...") behind — see cleanMovetext.

import { ANNOTATION_INFO } from "../annotation";

export type CleanupOptions = {
    /** Strip `{ ... }` comments. */
    removeComments: boolean;
    /** Strip `( ... )` sub-variations (recursively). */
    removeVariations: boolean;
    /** Strip `$N` numeric annotation glyphs. */
    removeNags: boolean;
    /** Strip move suffix glyphs (`!`, `?`, `!?` …) and standalone symbol glyphs (`±`, `⩲` …). */
    removeGlyphs: boolean;
    /** Strip `%`-escape lines. */
    removeEscapes: boolean;
};

/** Everything on — the "Kontrola" preset that reduces a game to its bare mainline. */
export const FULL_CLEANUP: CleanupOptions = {
    removeComments: true,
    removeVariations: true,
    removeNags: true,
    removeGlyphs: true,
    removeEscapes: true,
};

/** Nothing removed — a passthrough baseline callers can spread over. */
export const NO_CLEANUP: CleanupOptions = {
    removeComments: false,
    removeVariations: false,
    removeNags: false,
    removeGlyphs: false,
    removeEscapes: false,
};

// Standalone annotation-symbol tokens (e.g. "±", "⩲", "+-"). Derived from the app's
// own annotation table so it stays in sync. "N" (novelty) is excluded on purpose —
// a bare "N" token is too easy to confuse with real text, and novelties normally
// arrive as `$146` anyway.
const GLYPH_SYMBOLS = new Set(
    (Object.keys(ANNOTATION_INFO) as string[]).filter((s) => s !== "" && s !== "N"),
);

const RESULT_RE = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE_NUMBER_RE = /^\d+\.+$/; // "12." (white) or "12..." (black continuation)
const BLACK_CONT_RE = /^\d+\.{3,}$/; // "12..." black move-number continuation
// A move number glued onto the SAN, e.g. "12...Nf6" or "3.e4".
const GLUED_NUMBER_RE = /^(\d+\.{3,}|\d+\.)(.+)$/;

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Remove diacritics (NFD + drop combining marks). Storage always keeps diacritics;
 *  this is only used at export time (Swiss Manager / ŠSČR upload want ASCII). */
export function removeDiacritics(s: string): string {
    return (s ?? "").normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Strip trailing move-evaluation glyphs (`!`, `?` and combinations) from a SAN
 *  token while preserving check/mate/promotion markers (`+`, `#`, `=Q`). */
export function stripMoveGlyphs(token: string): string {
    return token.replace(/[?!]+$/, "");
}

type Kind = "start" | "move" | "movenum" | "result" | "comment" | "variation" | "nag" | "glyph";

function normalizeComment(body: string): string {
    return body.replace(/\s+/g, " ").trim();
}

/**
 * Clean a PGN movetext string according to `opts`.
 *
 * Single left-to-right scan over the raw text. Comments `{…}`, variations `(…)`
 * (balanced, recursively cleaned when kept), NAGs `$N` and `%`-escape lines are
 * each dropped or kept per the options; move tokens have their suffix glyphs
 * stripped when requested; the result terminator is preserved.
 *
 * Crucially, a black move-continuation number ("12...") is emitted only when it
 * follows a *kept* interruption (a comment or variation) or opens the line —
 * exactly when it disambiguates a black move. So removing a comment or variation
 * that preceded one never leaves a dangling "12..." behind (the bug this fixes).
 */
export function cleanMovetext(movetext: string, opts: CleanupOptions = FULL_CLEANUP): string {
    const out: string[] = [];
    let prev: Kind = "start";
    const text = movetext;
    const n = text.length;
    let i = 0;

    const isLineStart = (idx: number) => idx === 0 || text[idx - 1] === "\n";

    // Emit a move-number token, honoring the black-continuation rule.
    const pushMoveNumber = (num: string) => {
        if (BLACK_CONT_RE.test(num)) {
            if (prev === "comment" || prev === "variation" || prev === "start") {
                out.push(num);
                prev = "movenum";
            }
            // otherwise redundant → drop
        } else {
            out.push(num);
            prev = "movenum";
        }
    };

    while (i < n) {
        const ch = text[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // %-escape line
        if (ch === "%" && isLineStart(i)) {
            const end = text.indexOf("\n", i);
            const line = end === -1 ? text.slice(i) : text.slice(i, end);
            if (!opts.removeEscapes) {
                out.push(line.trim());
                prev = "comment";
            }
            i = end === -1 ? n : end + 1;
            continue;
        }

        // comment
        if (ch === "{") {
            const end = text.indexOf("}", i + 1);
            const body = end === -1 ? text.slice(i) + "}" : text.slice(i, end + 1);
            if (!opts.removeComments) {
                out.push(normalizeComment(body));
                prev = "comment";
            }
            i = end === -1 ? n : end + 1;
            continue;
        }

        // variation (balanced)
        if (ch === "(") {
            let depth = 0;
            let j = i;
            for (; j < n; j++) {
                if (text[j] === "(") depth++;
                else if (text[j] === ")") {
                    depth--;
                    if (depth === 0) {
                        j++;
                        break;
                    }
                }
            }
            if (!opts.removeVariations) {
                const inner = text.slice(i + 1, j - 1);
                out.push(`(${cleanMovetext(inner, opts)})`);
                prev = "variation";
            }
            i = j;
            continue;
        }

        // NAG
        if (ch === "$") {
            let j = i + 1;
            while (j < n && /\d/.test(text[j])) j++;
            if (!opts.removeNags) {
                out.push(text.slice(i, j));
                prev = "nag";
            }
            i = j;
            continue;
        }

        // generic whitespace/structure-delimited token
        let j = i;
        while (j < n && !/\s/.test(text[j]) && !"{}()$".includes(text[j])) j++;
        let tok = text.slice(i, j);
        i = j;

        if (RESULT_RE.test(tok)) {
            out.push(tok);
            prev = "result";
            continue;
        }

        if (MOVE_NUMBER_RE.test(tok)) {
            pushMoveNumber(tok);
            continue;
        }

        if (GLYPH_SYMBOLS.has(tok)) {
            if (!opts.removeGlyphs) {
                out.push(tok);
                prev = "glyph";
            }
            continue;
        }

        // SAN token — split a glued leading move number, then strip suffix glyphs.
        const glued = tok.match(GLUED_NUMBER_RE);
        if (glued) {
            pushMoveNumber(glued[1]);
            tok = glued[2];
        }
        const san = opts.removeGlyphs ? stripMoveGlyphs(tok) : tok;
        if (san) {
            out.push(san);
            prev = "move";
        }
    }

    return out.join(" ");
}

/** Full clean: mainline only, no comments/variations/NAGs/glyphs. (Kontrola output.) */
export function stripMovetext(movetext: string): string {
    return cleanMovetext(movetext, FULL_CLEANUP);
}

/** True if the movetext contains at least one top-level `( … )` variation. */
export function hasAnyTopLevelVariation(movetext: string): boolean {
    const withoutComments = movetext.replace(/\{[^}]*\}/g, " ");
    let depth = 0;
    for (const ch of withoutComments) {
        if (ch === "(") {
            if (depth === 0) return true;
            depth++;
        } else if (ch === ")") {
            if (depth > 0) depth--;
        }
    }
    return false;
}

export type ArtifactCounts = {
    comments: number;
    variations: number;
    nags: number;
    glyphs: number;
    escapes: number;
};

/** True if the movetext carries any of the artifacts Kontrola would strip. */
export function hasArtifacts(counts: ArtifactCounts): boolean {
    return (
        counts.comments > 0 ||
        counts.variations > 0 ||
        counts.nags > 0 ||
        counts.glyphs > 0 ||
        counts.escapes > 0
    );
}

function countTopLevelVariations(text: string): number {
    let depth = 0;
    let count = 0;
    for (const ch of text) {
        if (ch === "(") {
            if (depth === 0) count++;
            depth++;
        } else if (ch === ")") {
            if (depth > 0) depth--;
        }
    }
    return count;
}

function countGlyphs(movetext: string): number {
    // Count glyphs only in the mainline text that survives comment/variation/NAG
    // removal, so a "!" inside a comment isn't double-counted.
    const bare = cleanMovetext(movetext, {
        removeComments: true,
        removeVariations: true,
        removeNags: true,
        removeGlyphs: false,
        removeEscapes: true,
    });
    let count = 0;
    for (const tok of bare.split(/\s+/).filter(Boolean)) {
        if (RESULT_RE.test(tok) || MOVE_NUMBER_RE.test(tok)) continue;
        if (GLYPH_SYMBOLS.has(tok) || stripMoveGlyphs(tok) !== tok) count++;
    }
    return count;
}

/** Tally the removable artifacts in a movetext (drives the Kontrola report). */
export function countArtifacts(movetext: string): ArtifactCounts {
    const noComments = movetext.replace(/\{[^}]*\}/g, " ");
    return {
        comments: (movetext.match(/\{[^}]*\}/g) ?? []).length,
        variations: countTopLevelVariations(noComments),
        nags: (movetext.match(/\$\d+/g) ?? []).length,
        glyphs: countGlyphs(movetext),
        escapes: (movetext.match(/^%[^\n]*/gm) ?? []).length,
    };
}

/** Replace (or append) the movetext result terminator so it matches the Result
 *  header. Keeps the two in sync after cleaning/editing. */
export function syncMovetextResult(movetext: string, result: string): string {
    const re = /(1-0|0-1|1\/2-1\/2|\*)\s*$/;
    const trimmed = movetext.trimEnd();
    return re.test(trimmed) ? trimmed.replace(re, result) : `${trimmed} ${result}`.trim();
}

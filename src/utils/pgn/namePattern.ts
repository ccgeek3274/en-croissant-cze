// Vzory (patterns) for derived names: the `Event` tag and the file name of an
// exported PGN. Both are composed from the competition's abbreviation and team
// labels, so both belong to the leader — hence a pattern rather than a hard-coded
// format. Ported from pgn-base's `lib/namePattern.ts`; the defaults reproduce the
// formats that were hard-coded before, so nothing changes until someone edits one.
//
// Storage keeps diacritics; `sanitizeFileBase` is an export-time transform, applied
// to every name that becomes a file name.

/** Event tag: reproduces the pre-pattern format "<zkratka> <domácí>-<hosté>". */
export const DEFAULT_EVENT_PATTERN = "{zkratka} {domaci}-{hoste}";
/** Round PGN filename (without .pgn), e.g. "ksa_01". */
export const DEFAULT_FILE_PATTERN = "{soutez}_{kolo}";

/** Placeholders offered in the dialog, in the order they are listed to the user. */
export const PATTERN_VARS = [
    { key: "zkratka", example: "KSA SSS 25/26" },
    { key: "soutez", example: "ksa" },
    { key: "kolo", example: "01" },
    { key: "domaci", example: "Sedlcany A" },
    { key: "hoste", example: "Revnice A" },
] as const;

export type PatternVars = {
    zkratka?: string | null;
    domaci?: string | null;
    hoste?: string | null;
    kolo?: number | string | null;
};

/** Diacritics → ASCII (export-side transform; storage keeps them). */
function toAscii(s: string): string {
    return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "KSA SSS 25/26" → "ksa" — the short competition slug used in file names. */
export function compSlug(prefix: string | null | undefined): string {
    const first = (prefix ?? "").trim().split(/\s+/)[0] ?? "";
    return sanitizeFileBase(toAscii(first).toLowerCase());
}

/**
 * File-name-safe base: ASCII letters, digits, `_` and `-` only. Diacritics are
 * transliterated first (Sedlčany → Sedlcany), everything else collapses into a
 * single `_`, and leading/trailing separators are trimmed. May come back empty —
 * callers pair it with `|| FILE_BASE_FALLBACK`.
 */
export function sanitizeFileBase(name: string | null | undefined): string {
    return toAscii(name ?? "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[_-]+|[_-]+$/g, "");
}

/** Name for an export whose every other source of a name came back empty. */
export const FILE_BASE_FALLBACK = "export";

/** Substitute {placeholders}; unknown ones are left verbatim so a typo shows up in
 *  the preview instead of in the exported file. */
export function fillPattern(pattern: string, vars: PatternVars): string {
    const kolo = vars.kolo == null || vars.kolo === "" ? "" : String(vars.kolo).padStart(2, "0");
    const table: Record<string, string> = {
        zkratka: (vars.zkratka ?? "").trim(),
        soutez: compSlug(vars.zkratka),
        kolo,
        domaci: (vars.domaci ?? "").trim(),
        hoste: (vars.hoste ?? "").trim(),
    };
    return pattern.replace(/\{(\w+)\}/g, (whole, key: string) =>
        key in table ? table[key] : whole,
    );
}

/** Event tag from the competition's pattern (falls back to the default one). */
export function buildEventFromPattern(
    pattern: string | null | undefined,
    vars: PatternVars,
): string {
    const out = fillPattern((pattern ?? "").trim() || DEFAULT_EVENT_PATTERN, vars)
        .trim()
        .replace(/\s+/g, " ");
    // A pattern that resolves to nothing would produce an empty Event tag — the
    // default is a safer answer than a blank one.
    return out || fillPattern(DEFAULT_EVENT_PATTERN, vars).trim().replace(/\s+/g, " ");
}

/** PGN file-name base (no extension) from the competition's pattern. */
export function buildFileBaseFromPattern(
    pattern: string | null | undefined,
    vars: PatternVars,
): string {
    const raw = fillPattern((pattern ?? "").trim() || DEFAULT_FILE_PATTERN, vars);
    return (
        sanitizeFileBase(raw) ||
        sanitizeFileBase(fillPattern(DEFAULT_FILE_PATTERN, vars)) ||
        FILE_BASE_FALLBACK
    );
}

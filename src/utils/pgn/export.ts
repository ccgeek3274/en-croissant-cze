// PGN export with pgn-base-style options, applied to any database of games.
//
// Three orthogonal axes, exactly like pgn-base's buildPgn, plus the Kontrola
// cleanup toggles so an export can be as clean as a "Kontrola"-processed file:
//   - headers:        "all" (keep every tag, original order) | "standard" (STR subset)
//   - movetext:       keep verbatim | clean (per CleanupOptions)
//   - diacritics:     keep | strip (whole output, export-time only)
//
// Storage is always full/rich; these are export-time filters — nothing here mutates
// the database.

import {
    type CleanupOptions,
    cleanMovetext,
    removeDiacritics,
    syncMovetextResult,
} from "./cleanup";
import { getTag, type PgnTags, serializeGame, splitGame } from "./tags";

export type HeaderMode = "all" | "standard";

export type ExportOptions = {
    headers: HeaderMode;
    /** null = keep movetext verbatim; otherwise clean per these toggles. */
    cleanup: CleanupOptions | null;
    stripDiacritics: boolean;
};

// The "standard" export subset: Seven Tag Roster in canonical order, then the few
// widely-understood optional tags. Everything else is dropped in "standard" mode.
const SEVEN_TAG_ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
const STANDARD_OPTIONAL = ["WhiteElo", "BlackElo", "ECO", "PlyCount"];

const STR_DEFAULTS: Record<string, string> = {
    Event: "?",
    Site: "?",
    Date: "????.??.??",
    Round: "?",
    White: "?",
    Black: "?",
    Result: "*",
};

/** Reduce tags to the standard subset, filling STR defaults and canonical order. */
function toStandardTags(tags: PgnTags): PgnTags {
    const order: string[] = [];
    const map: Record<string, string> = {};
    for (const name of SEVEN_TAG_ROSTER) {
        order.push(name);
        map[name] = getTag(tags, name) ?? STR_DEFAULTS[name] ?? "?";
    }
    for (const name of STANDARD_OPTIONAL) {
        const v = getTag(tags, name);
        if (v !== undefined && v !== "") {
            order.push(name);
            map[name] = v;
        }
    }
    return { order, map };
}

/** Build the export text for a single game (given its raw PGN block). */
export function buildExportGame(gameText: string, opts: ExportOptions): string {
    const { tags, movetext } = splitGame(gameText);
    const outTags = opts.headers === "standard" ? toStandardTags(tags) : tags;

    let moves = opts.cleanup ? cleanMovetext(movetext, opts.cleanup) : movetext;
    // Keep the movetext terminator in sync with the Result header (cleaning can
    // drop a trailing token; standard headers always carry a Result).
    const result = outTags.map.Result;
    if (result) moves = syncMovetextResult(moves, result);

    const out = serializeGame(outTags, moves);
    return opts.stripDiacritics ? removeDiacritics(out) : out;
}

/** Build a multi-game PGN file from a list of raw game blocks. */
export function buildExportPgn(games: string[], opts: ExportOptions): string {
    return games.map((g) => buildExportGame(g, opts)).join("\n\n\n") + "\n";
}

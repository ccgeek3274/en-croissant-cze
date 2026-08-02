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
    /** When set, keep exactly these tags, in this order; roster tags are filled with
     *  their STR default if absent, other selected-but-absent tags are simply skipped.
     *  Takes precedence over `headers`. */
    keepTags?: string[];
    /** null = keep movetext verbatim; otherwise clean per these toggles. */
    cleanup: CleanupOptions | null;
    stripDiacritics: boolean;
};

// The Seven Tag Roster, always present in a valid PGN (filled with defaults below).
const SEVEN_TAG_ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];

// The "standard" export subset: STR plus the widely-understood optional tags and the
// team tags used by ŠSČR match files. Also the default pre-selection in the export
// dialog's tag picker; everything else is dropped in "standard" mode.
export const STANDARD_TAGS = [
    "Event",
    "Site",
    "Date",
    "Round",
    "White",
    "Black",
    "Result",
    "ECO",
    "WhiteElo",
    "BlackElo",
    "PlyCount",
    "WhiteTeam",
    "BlackTeam",
];

const STR_DEFAULTS: Record<string, string> = {
    Event: "?",
    Site: "?",
    Date: "????.??.??",
    Round: "?",
    White: "?",
    Black: "?",
    Result: "*",
};

/** Keep only `keep` tags, in that order. Roster tags are always emitted (filled with
 *  their STR default when absent); any other selected-but-absent tag is skipped. */
function selectTags(tags: PgnTags, keep: string[]): PgnTags {
    const order: string[] = [];
    const map: Record<string, string> = {};
    for (const name of keep) {
        const v = getTag(tags, name);
        if (v !== undefined && v !== "") {
            order.push(name);
            map[name] = v;
        } else if (SEVEN_TAG_ROSTER.includes(name)) {
            order.push(name);
            map[name] = STR_DEFAULTS[name] ?? "?";
        }
    }
    return { order, map };
}

/** Build the export text for a single game (given its raw PGN block). */
export function buildExportGame(gameText: string, opts: ExportOptions): string {
    const { tags, movetext } = splitGame(gameText);
    const outTags = opts.keepTags
        ? selectTags(tags, opts.keepTags)
        : opts.headers === "standard"
          ? selectTags(tags, STANDARD_TAGS)
          : tags;

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

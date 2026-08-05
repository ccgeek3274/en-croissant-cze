// The PGN `White`/`Black` tag value: "Příjmení, Jméno".
//
// The comma is part of the PGN spec, not decoration — and every Czech source we
// read writes the name without it: the Swiss-Manager XML has a single `<name>`
// field ("Příjmení Jméno"), and `api.chess.cz` serves `fullName` the same way.
// So one normalizer, applied on the way in (import) *and* on the way out (export),
// because a database may have been filled before this existed or by hand.
//
// It is idempotent, which is what makes running it twice harmless.
//
// The first whitespace token is the surname — with one documented exception: a
// generational suffix ("st." / "ml.") belongs to the surname, not to the given
// name. Both rules were verified against the PGN Swiss-Manager exports from the
// same data ("Aulický st. Radim" → "Aulický st., Radim", "Nguyen Minh Khang
// Tomáš" → "Nguyen, Minh Khang Tomáš").

/** Tokens that stay glued to the surname. Compared lower-cased, dots stripped. */
const SURNAME_SUFFIXES = new Set(["st", "ml", "sen", "jun", "sr", "jr"]);

function isSurnameSuffix(token: string): boolean {
    return SURNAME_SUFFIXES.has(token.toLowerCase().replace(/\.+$/, ""));
}

/** "Příjmení Jméno" → "Příjmení, Jméno".
 *
 *  Left alone (bar whitespace tidying):
 *   - values that already have a comma — only the spacing around it is fixed,
 *   - anything containing a digit: the "Domácí 3" / "Hosté 3" board placeholders,
 *     which the export must not turn into "Domácí, 3",
 *   - single-token values ("NN", "?"), where there is no given name to split off. */
export function toPgnName(raw: string | null | undefined): string {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    if (name === "") return "";
    if (name.includes(",")) return name.replace(/\s*,\s*/g, ", ").trim();
    if (/\d/.test(name)) return name;

    const tokens = name.split(" ");
    if (tokens.length < 2) return name;

    let cut = 1;
    // Absorb suffixes, but never the last token — something has to remain as the
    // given name.
    while (cut < tokens.length - 1 && isSurnameSuffix(tokens[cut])) cut++;

    return `${tokens.slice(0, cut).join(" ")}, ${tokens.slice(cut).join(" ")}`;
}

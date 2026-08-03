// Player names in the competition XML are a single `<name>` field written as
// "Příjmení Jméno" (surname first, no comma). PGN wants "Surname, Given".
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

/** "Příjmení Jméno" → "Příjmení, Jméno". Input that already has a comma, or that
 *  is a single token, is returned unchanged (bar whitespace normalization). */
export function toPgnName(raw: string | null | undefined): string {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    if (name === "" || name.includes(",")) return name;

    const tokens = name.split(" ");
    if (tokens.length < 2) return name;

    let cut = 1;
    // Absorb suffixes, but never the last token — something has to remain as the
    // given name.
    while (cut < tokens.length - 1 && isSurnameSuffix(tokens[cut])) cut++;

    return `${tokens.slice(0, cut).join(" ")}, ${tokens.slice(cut).join(" ")}`;
}

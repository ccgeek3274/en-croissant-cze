// Parse and serialize the tag-pair section of a PGN game as plain text.
//
// General and database-agnostic: it keeps every tag and its original order by
// default (so round-tripping an arbitrary PGN is lossless), and never touches the
// movetext. Header-centric features (Kontrola, Export, the future competition
// leader mode) build on this instead of parsing games into chessops trees.

export type PgnTags = {
    /** Tag names in the order they appeared. */
    order: string[];
    /** Tag name → value. */
    map: Record<string, string>;
};

export type ParsedGame = {
    tags: PgnTags;
    /** Everything after the tag section, verbatim (leading blank line trimmed). */
    movetext: string;
};

const TAG_LINE_RE = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;

function unescapeTagValue(v: string): string {
    return v.replace(/\\(["\\])/g, "$1");
}

function escapeTagValue(v: string): string {
    return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Split one game's PGN text into its tag pairs and its movetext. */
export function splitGame(gameText: string): ParsedGame {
    const lines = gameText.split(/\r?\n/);
    const order: string[] = [];
    const map: Record<string, string> = {};

    let i = 0;
    for (; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") {
            // Blank line ends the tag section only once we've seen tags; leading
            // blank lines before the tags are skipped.
            if (order.length > 0) {
                i++;
                break;
            }
            continue;
        }
        const m = line.match(TAG_LINE_RE);
        if (!m) break; // first non-tag, non-blank line → movetext starts here
        const [, name, rawValue] = m;
        if (!(name in map)) order.push(name);
        map[name] = unescapeTagValue(rawValue);
    }

    const movetext = lines.slice(i).join("\n").trim();
    return { tags: { order, map }, movetext };
}

/** Split a multi-game PGN string into individual game blocks. A new game begins at
 *  a tag line only once movetext has been seen for the current one, so tag pairs
 *  that merely span several lines don't split a game. */
export function splitPgnGames(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const games: string[] = [];
    let cur: string[] = [];
    let seenMoves = false;

    const flush = () => {
        const g = cur.join("\n").trim();
        if (g) games.push(g);
        cur = [];
        seenMoves = false;
    };

    for (const line of lines) {
        const isTag = /^\s*\[\w+\s+"/.test(line);
        if (isTag && seenMoves) flush();
        if (!isTag && line.trim() !== "") seenMoves = true;
        cur.push(line);
    }
    flush();
    return games;
}

/** Get a tag value case-insensitively (PGN tag names are case-sensitive by spec,
 *  but real-world files vary — helps when reading foreign databases). */
export function getTag(tags: PgnTags, name: string): string | undefined {
    if (name in tags.map) return tags.map[name];
    const lower = name.toLowerCase();
    const hit = tags.order.find((k) => k.toLowerCase() === lower);
    return hit ? tags.map[hit] : undefined;
}

/** Serialize tag pairs in the given order, then the movetext, as a PGN block. */
export function serializeGame(tags: PgnTags, movetext: string): string {
    const lines = tags.order
        .filter((name) => tags.map[name] !== undefined)
        .map((name) => `[${name} "${escapeTagValue(tags.map[name])}"]`);
    return `${lines.join("\n")}\n\n${movetext.trim()}`;
}

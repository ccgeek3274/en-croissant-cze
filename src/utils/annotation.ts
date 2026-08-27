import type { MantineColor } from "@mantine/core";

export type MoveNotationType = "symbols" | "letters" | "letters-cs";

/** Solid glyphs: the outlined ones (♔♕♖♗♘) blur together at notation sizes. */
const PIECE_SYMBOLS = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
const CZECH_PIECE_LETTERS = { K: "K", Q: "D", R: "V", B: "S", N: "J" };

/** Every glyph PIECE_SYMBOLS can produce, for splitting a formatted move. */
export const PIECE_SYMBOL_SPLIT = /([♚♛♜♝♞])/;

/** Matches a piece letter where SAN can hold one: leading, or after a promotion "=". */
const PIECE_LETTER = /(^|=)([KQRBN])/g;

function replacePieceLetters(move: string, table: Record<string, string>): string {
    return move.replace(PIECE_LETTER, (_, prefix: string, piece: string) => prefix + table[piece]);
}

export function formatMove(move: string, notation: MoveNotationType): string {
    if (notation === "symbols") return replacePieceLetters(move, PIECE_SYMBOLS);
    if (notation === "letters-cs") return replacePieceLetters(move, CZECH_PIECE_LETTERS);
    return move;
}

export type Annotation =
    | ""
    | "!"
    | "!!"
    | "?"
    | "??"
    | "!?"
    | "?!"
    | "+-"
    | "±"
    | "⩲"
    | "="
    | "∞"
    | "⩱"
    | "∓"
    | "-+"
    | "N"
    | "↑↑"
    | "↑"
    | "→"
    | "⇆"
    | "=∞"
    | "⊕"
    | "∆"
    | "□"
    | "⨀"
    | "⊗";

export const NAG_INFO = new Map<string, Annotation>([
    ["$1", "!"],
    ["$2", "?"],
    ["$3", "!!"],
    ["$4", "??"],
    ["$5", "!?"],
    ["$6", "?!"],
    ["$7", "□"],
    ["$9", "⊗"],
    ["$10", "="],
    ["$13", "∞"],
    ["$14", "⩲"],
    ["$15", "⩱"],
    ["$16", "±"],
    ["$17", "∓"],
    ["$18", "+-"],
    ["$19", "-+"],
    ["$22", "⨀"],
    ["$23", "⨀"],
    ["$32", "↑↑"],
    ["$33", "↑↑"],
    ["$36", "↑"],
    ["$37", "↑"],
    ["$40", "→"],
    ["$41", "→"],
    ["$44", "=∞"],
    ["$45", "=∞"],
    ["$132", "⇆"],
    ["$133", "⇆"],
    ["$138", "⊕"],
    ["$139", "⊕"],
    ["$140", "∆"],
    ["$146", "N"],
]);

type AnnotationInfo = {
    group?: string;
    name: string;
    translationKey?: string;
    color?: MantineColor;
    nag: number;
};

export const ANNOTATION_INFO: Record<Annotation, AnnotationInfo> = {
    "": { name: "None", color: "gray", nag: 0 },
    "!!": {
        group: "basic",
        name: "Brilliant",
        translationKey: "Brilliant",
        color: "cyan",
        nag: 3,
    },
    "!": {
        group: "basic",
        name: "Good",
        translationKey: "Good",
        color: "teal",
        nag: 1,
    },
    "!?": {
        group: "basic",
        name: "Interesting",
        translationKey: "Interesting",
        color: "lime",
        nag: 5,
    },
    "?!": {
        group: "basic",
        name: "Dubious",
        translationKey: "Dubious",
        color: "yellow",
        nag: 6,
    },
    "?": {
        group: "basic",
        name: "Mistake",
        translationKey: "Mistake",
        color: "orange",
        nag: 2,
    },
    "??": {
        group: "basic",
        name: "Blunder",
        translationKey: "Blunder",
        color: "red",
        nag: 4,
    },
    "+-": {
        group: "advantage",
        name: "White is winning",
        translationKey: "WhiteWinning",
        nag: 18,
    },
    "±": {
        group: "advantage",
        name: "White has a clear advantage",
        translationKey: "WhiteAdvantage",
        nag: 16,
    },
    "⩲": {
        group: "advantage",
        name: "White has a slight advantage",
        translationKey: "WhiteEdge",
        nag: 14,
    },
    "=": {
        group: "advantage",
        name: "Equal position",
        translationKey: "Equal",
        nag: 10,
    },
    "∞": {
        group: "advantage",
        name: "Unclear position",
        translationKey: "Unclear",
        nag: 13,
    },
    "⩱": {
        group: "advantage",
        name: "Black has a slight advantage",
        translationKey: "BlackEdge",
        nag: 15,
    },
    "∓": {
        group: "advantage",
        name: "Black has a clear advantage",
        translationKey: "BlackAdvantage",
        nag: 17,
    },
    "-+": {
        group: "advantage",
        name: "Black is winning",
        translationKey: "BlackWinning",
        nag: 19,
    },
    N: { name: "Novelty", translationKey: "Novelty", nag: 146 },
    "↑↑": { name: "Development", translationKey: "Development", nag: 32 },
    "↑": { name: "Initiative", translationKey: "Initiative", nag: 36 },
    "→": { name: "Attack", translationKey: "Attack", nag: 40 },
    "⇆": { name: "Counterplay", translationKey: "Counterplay", nag: 132 },
    "=∞": {
        name: "With compensation",
        translationKey: "WithCompensation",
        nag: 44,
    },
    "⊕": { name: "Time Trouble", translationKey: "TimeTrouble", nag: 138 },
    "∆": { name: "With the idea", translationKey: "WithIdea", nag: 140 },
    "□": { name: "Only move", translationKey: "OnlyMove", nag: 7 },
    "⨀": { name: "Zugzwang", translationKey: "Zugzwang", nag: 22 },
    "⊗": { name: "Miss", color: "red", nag: 9 },
};

export function isBasicAnnotation(
    annotation: string,
): annotation is "!" | "!!" | "?" | "??" | "!?" | "?!" {
    return ["!", "!!", "?", "??", "!?", "?!"].includes(annotation);
}

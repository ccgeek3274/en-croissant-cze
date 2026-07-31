import { describe, expect, it } from "vitest";
import { getTag, serializeGame, splitGame, splitPgnGames } from "./tags";

const GAME = `[Event "Cup"]
[White "A, A"]
[Black "B, B"]
[Result "1-0"]

1. e4 e5 1-0`;

describe("splitGame", () => {
    it("parses tags in order and separates movetext", () => {
        const { tags, movetext } = splitGame(GAME);
        expect(tags.order).toEqual(["Event", "White", "Black", "Result"]);
        expect(tags.map.Event).toBe("Cup");
        expect(movetext).toBe("1. e4 e5 1-0");
    });

    it("unescapes quoted values", () => {
        const { tags } = splitGame('[White "O\\"Brien, S"]\n\n*');
        expect(tags.map.White).toBe('O"Brien, S');
    });

    it("round-trips through serializeGame", () => {
        const { tags, movetext } = splitGame(GAME);
        expect(splitGame(serializeGame(tags, movetext)).tags.map).toEqual(tags.map);
    });
});

describe("getTag", () => {
    it("falls back to a case-insensitive match", () => {
        const { tags } = splitGame('[whiteelo "2000"]\n\n*');
        expect(getTag(tags, "WhiteElo")).toBe("2000");
    });
});

describe("splitPgnGames", () => {
    it("splits a multi-game PGN into blocks", () => {
        const multi = `${GAME}\n\n\n[Event "Cup"]\n[White "C, C"]\n[Black "D, D"]\n[Result "0-1"]\n\n1. d4 d5 0-1`;
        const games = splitPgnGames(multi);
        expect(games).toHaveLength(2);
        expect(splitGame(games[1]).tags.map.White).toBe("C, C");
    });

    it("does not split a single game across its own multi-line tag section", () => {
        expect(splitPgnGames(GAME)).toHaveLength(1);
    });

    it("ignores trailing whitespace", () => {
        expect(splitPgnGames(`${GAME}\n\n\n`)).toHaveLength(1);
    });
});

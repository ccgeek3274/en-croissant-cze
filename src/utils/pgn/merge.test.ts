import { describe, expect, it } from "vitest";
import { applyMergedMovetext, planMerge } from "./merge";
import { splitGame } from "./tags";

function game(round: string, white: string, black: string, moves = "*", result = "*"): string {
    return `[Event "T"]\n[Round "${round}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n\n${moves}`;
}

describe("planMerge", () => {
    it("pairs imported games to targets by name even when order differs", () => {
        const targets = [
            game("1.1", "Kovář, Jiří", "Novák, Petr"),
            game("1.2", "Svoboda, Jan", "Dvořák, Karel"),
        ];
        const imported = [
            game("1.2", "Svoboda, Jan", "Dvořák, Karel", "1. d4 d5 1-0", "1-0"),
            game("1.1", "Kovar, Jiri", "Novak, Petr", "1. e4 e5 0-1", "0-1"),
        ];
        const plan = planMerge(targets, imported);
        expect(plan.rows[0].imported).toBe(1); // target 0 ↔ imported 1 (diacritic-insensitive)
        expect(plan.rows[1].imported).toBe(0);
        expect(plan.rows[0].level).toBe(2);
        expect(plan.appendedImported).toEqual([]);
    });

    it("reports leftover imported games that match no target", () => {
        const targets = [game("1.1", "A, A", "B, B")];
        const imported = [
            game("1.1", "A, A", "B, B", "1. e4 *"),
            game("1.2", "C, C", "D, D", "1. d4 *"),
        ];
        const plan = planMerge(targets, imported);
        expect(plan.appendedImported).toEqual([1]);
    });
});

describe("applyMergedMovetext", () => {
    it("copies imported moves and result while keeping target headers", () => {
        const target = game("1.1", "Kovář, Jiří", "Novák, Petr");
        const imported = game("1.1", "Kovar, Jiri", "Novak, Petr", "1. e4 e5 1-0", "1-0");
        const merged = applyMergedMovetext(target, imported);
        const { tags, movetext } = splitGame(merged);
        expect(tags.map.White).toBe("Kovář, Jiří"); // target header kept (diacritics)
        expect(tags.map.Result).toBe("1-0"); // result adopted from import
        expect(movetext).toBe("1. e4 e5 1-0");
    });
});

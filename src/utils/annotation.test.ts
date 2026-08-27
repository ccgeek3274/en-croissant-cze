import { describe, expect, test } from "vitest";
import { formatMove } from "./annotation";

describe("formatMove", () => {
    test("leaves the move alone in English letters", () => {
        expect(formatMove("Nf3", "letters")).toBe("Nf3");
        expect(formatMove("e8=Q+", "letters")).toBe("e8=Q+");
    });

    test("uses solid glyphs for symbols", () => {
        expect(formatMove("Nf3", "symbols")).toBe("♞f3");
        expect(formatMove("Qxd5", "symbols")).toBe("♛xd5");
        expect(formatMove("Kg1", "symbols")).toBe("♚g1");
    });

    test("uses Czech letters", () => {
        expect(formatMove("Nf3", "letters-cs")).toBe("Jf3");
        expect(formatMove("Qxd5", "letters-cs")).toBe("Dxd5");
        expect(formatMove("Rae1", "letters-cs")).toBe("Vae1");
        expect(formatMove("Bb5+", "letters-cs")).toBe("Sb5+");
        expect(formatMove("Kg1", "letters-cs")).toBe("Kg1");
    });

    test("converts the promotion piece too", () => {
        expect(formatMove("e8=Q+", "symbols")).toBe("e8=♛+");
        expect(formatMove("e8=Q+", "letters-cs")).toBe("e8=D+");
        expect(formatMove("bxa1=N", "letters-cs")).toBe("bxa1=J");
    });

    test("leaves pawn moves, castling and disambiguation files alone", () => {
        expect(formatMove("e4", "letters-cs")).toBe("e4");
        expect(formatMove("O-O", "letters-cs")).toBe("O-O");
        expect(formatMove("O-O-O#", "symbols")).toBe("O-O-O#");
        expect(formatMove("Nbd7", "letters-cs")).toBe("Jbd7");
        expect(formatMove("exd5", "symbols")).toBe("exd5");
    });
});

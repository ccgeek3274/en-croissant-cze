import { describe, expect, it } from "vitest";
import {
    cleanMovetext,
    countArtifacts,
    FULL_CLEANUP,
    hasAnyTopLevelVariation,
    removeDiacritics,
    stripMovetext,
    syncMovetextResult,
} from "./cleanup";

describe("stripMovetext", () => {
    it("keeps a plain mainline unchanged", () => {
        expect(stripMovetext("1. e4 e5 2. Nf3 Nc6 1-0")).toBe("1. e4 e5 2. Nf3 Nc6 1-0");
    });

    it("removes comments, NAGs and glyphs", () => {
        const src = "1. e4! e5 $1 {a good start} 2. Nf3?! Nc6";
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6");
    });

    it("removes variations", () => {
        const src = "1. e4 e5 2. Nf3 (2. Bc4 Bc5) Nc6";
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6");
    });

    it("removes nested variations", () => {
        const src = "1. e4 e5 2. Nf3 (2. Bc4 (2... Nf6 3. d3) Bc5) Nc6";
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6");
    });
});

describe('the "..." fix', () => {
    it("drops the orphan black-continuation number left by a removed variation", () => {
        const src = "1. e4 e5 2. Nf3 (2. Bc4 Bc5) 2... Nc6 3. Bb5";
        // Without the fix, "2..." survives → "2. Nf3 2... Nc6".
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6 3. Bb5");
    });

    it("drops the orphan black-continuation number left by a removed comment", () => {
        const src = "1. e4 e5 2. Nf3 {develops} 2... Nc6";
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6");
    });

    it("keeps a black-continuation number that opens the movetext", () => {
        const src = "1... c5 2. Nf3 d6";
        expect(stripMovetext(src)).toBe("1... c5 2. Nf3 d6");
    });

    it("keeps the black-continuation number when its comment is kept", () => {
        const src = "1. e4 e5 2. Nf3 {develops} 2... Nc6";
        const kept = cleanMovetext(src, { ...FULL_CLEANUP, removeComments: false });
        expect(kept).toBe("1. e4 e5 2. Nf3 {develops} 2... Nc6");
    });

    it("handles a move number glued to the SAN after a stripped variation", () => {
        const src = "1. e4 e5 2. Nf3 (2. Bc4 Bc5) 2...Nc6";
        expect(stripMovetext(src)).toBe("1. e4 e5 2. Nf3 Nc6");
    });
});

describe("cleanMovetext options", () => {
    it("keeps variations but still strips glyphs inside them", () => {
        const src = "1. e4 e5 2. Nf3 (2. Bc4! Bc5?) Nc6";
        const out = cleanMovetext(src, { ...FULL_CLEANUP, removeVariations: false });
        expect(out).toBe("1. e4 e5 2. Nf3 (2. Bc4 Bc5) Nc6");
    });

    it("preserves check and promotion markers while stripping glyphs", () => {
        expect(stripMovetext("1. e8=Q+! Kd7 2. Qxd8#??")).toBe("1. e8=Q+ Kd7 2. Qxd8#");
    });
});

describe("countArtifacts", () => {
    it("tallies each artifact type", () => {
        const src = "1. e4! e5 $1 {c} 2. Nf3 (2. Bc4 Bc5) Nc6";
        const c = countArtifacts(src);
        expect(c.comments).toBe(1);
        expect(c.variations).toBe(1);
        expect(c.nags).toBe(1);
        expect(c.glyphs).toBe(1); // only mainline "e4!" — the "!" inside no comment
    });

    it("does not count glyphs that live inside comments or variations", () => {
        const src = "1. e4 e5 {good! move} (1... c5?)";
        expect(countArtifacts(src).glyphs).toBe(0);
    });
});

describe("hasAnyTopLevelVariation", () => {
    it("ignores parens inside comments", () => {
        expect(hasAnyTopLevelVariation("1. e4 {a (b) c} e5")).toBe(false);
        expect(hasAnyTopLevelVariation("1. e4 (1. d4) e5")).toBe(true);
    });
});

describe("syncMovetextResult", () => {
    it("replaces an existing terminator", () => {
        expect(syncMovetextResult("1. e4 e5 *", "1-0")).toBe("1. e4 e5 1-0");
    });
    it("appends when missing", () => {
        expect(syncMovetextResult("1. e4 e5", "0-1")).toBe("1. e4 e5 0-1");
    });
});

describe("removeDiacritics", () => {
    it("strips Czech diacritics", () => {
        expect(removeDiacritics("Kovář, Jiří")).toBe("Kovar, Jiri");
    });
});

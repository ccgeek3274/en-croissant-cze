import { describe, expect, it } from "vitest";
import {
    type ArtifactsCard,
    type DiacriticsCard,
    type DuplicatesCard,
    isPlaceholder,
    movetextResult,
    type ResultCard,
    pgncheck,
    stripGameDiacritics,
    syncGameResult,
    type TagsCard,
} from "./check";

function game(tags: Record<string, string>, movetext = "1. e4 e5 *"): string {
    const head = Object.entries(tags)
        .map(([k, v]) => `[${k} "${v}"]`)
        .join("\n");
    return `${head}\n\n${movetext}`;
}

const CLEAN = game(
    { Event: "Turnaj", Date: "2026.01.01", White: "Novak", Black: "Svoboda", Result: "1-0" },
    "1. e4 e5 2. Nf3 1-0",
);

function card<T>(games: string[], id: string): T {
    return pgncheck(games).cards.find((c) => c.id === id) as T;
}

describe("pgncheck — overall", () => {
    it("reports a clean single game", () => {
        const report = pgncheck([CLEAN]);
        expect(report.total).toBe(1);
        expect(report.clean).toBe(true);
        expect(report.cards.every((c) => c.status === "ok")).toBe(true);
    });

    it("marks all checks unknown for an empty list", () => {
        const report = pgncheck([]);
        expect(report.total).toBe(0);
        expect(report.cards.every((c) => c.status === "unknown")).toBe(true);
        // "unknown" is not a warning, so an empty file counts as clean.
        expect(report.clean).toBe(true);
    });
});

describe("pgncheck — artifacts", () => {
    it("tallies removable annotations per class and per game", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4! e5 $1 {comment} 2. Nf3 (2. Bc4 Bc5) Nc6 *",
        );
        const c = card<ArtifactsCard>([g], "artifacts");
        expect(c.status).toBe("warn");
        expect(c.affected).toBe(1);
        expect(c.totals.comments).toBe(1);
        expect(c.totals.variations).toBe(1);
        expect(c.totals.nags).toBe(1);
        expect(c.totals.glyphs).toBe(1);
        expect(c.games[0].counts.variations).toBe(1);
    });
});

describe("pgncheck — diacritics", () => {
    it("lists per-tag before→after changes", () => {
        const g = game({
            Event: "Přebor",
            White: "Dvořák",
            Black: "Svoboda",
            Result: "*",
            Date: "2026.01.01",
        });
        const c = card<DiacriticsCard>([g], "diacritics");
        expect(c.affected).toBe(1);
        const changes = c.games[0].changes;
        expect(changes).toContainEqual({ tag: "Event", from: "Přebor", to: "Prebor" });
        expect(changes).toContainEqual({ tag: "White", from: "Dvořák", to: "Dvorak" });
        // Svoboda has no diacritics → not listed.
        expect(changes.find((x) => x.tag === "Black")).toBeUndefined();
    });

    it("stripGameDiacritics rewrites only headers, keeps movetext", () => {
        const g = game(
            { Event: "Přebor", White: "Dvořák", Black: "B", Result: "*", Date: "2026.01.01" },
            "1. e4 e5 *",
        );
        const out = stripGameDiacritics(g);
        expect(out).toContain('[Event "Prebor"]');
        expect(out).toContain('[White "Dvorak"]');
        expect(out).toContain("1. e4 e5 *");
    });
});

describe("pgncheck — result", () => {
    it("flags a header/terminator mismatch", () => {
        const g = game(
            { White: "A", Black: "B", Result: "1-0", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 0-1",
        );
        const c = card<ResultCard>([g], "result");
        expect(c.affected).toBe(1);
        expect(c.games[0]).toMatchObject({ header: "1-0", movetext: "0-1" });
    });

    it("does not flag an ongoing (*) game", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 *",
        );
        expect(card<ResultCard>([g], "result").affected).toBe(0);
    });

    it("does not flag an empty scaffold with a decisive header", () => {
        const g = game(
            { White: "A", Black: "B", Result: "1-0", Event: "E", Date: "2026.01.01" },
            "",
        );
        expect(card<ResultCard>([g], "result").affected).toBe(0);
    });

    it("syncGameResult rewrites the terminator to the header", () => {
        const g = game(
            { White: "A", Black: "B", Result: "1-0", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 0-1",
        );
        expect(syncGameResult(g)).toContain("1. e4 e5 1-0");
    });
});

describe("pgncheck — tags", () => {
    it("flags missing and placeholder required tags", () => {
        const g = game({ Event: "?", White: "A", Black: "", Result: "1-0", Date: "2026.01.01" });
        const c = card<TagsCard>([g], "tags");
        expect(c.affected).toBe(1);
        expect(c.games[0].missing).toEqual(expect.arrayContaining(["Event", "Black"]));
        expect(c.games[0].missing).not.toContain("White");
    });
});

describe("pgncheck — duplicates", () => {
    it("groups games with the same pairing (diacritics-insensitive)", () => {
        const a = game({
            White: "Dvořák",
            Black: "Novák",
            Round: "1.1",
            Result: "1-0",
            Event: "E",
            Date: "2026.01.01",
        });
        const b = game({
            White: "Dvorak",
            Black: "Novak",
            Round: "1.1",
            Result: "0-1",
            Event: "E",
            Date: "2026.01.01",
        });
        const c = card<DuplicatesCard>([a, b], "duplicates");
        expect(c.affected).toBe(2);
        expect(c.groups).toHaveLength(1);
        expect(c.groups[0].games.map((x) => x.index)).toEqual([0, 1]);
    });

    it("does not flag distinct pairings", () => {
        const a = game({ White: "A", Black: "B", Round: "1.1", Result: "1-0", Event: "E", Date: "2026.01.01" });
        const b = game({ White: "C", Black: "D", Round: "1.2", Result: "0-1", Event: "E", Date: "2026.01.01" });
        expect(card<DuplicatesCard>([a, b], "duplicates").affected).toBe(0);
    });
});

describe("helpers", () => {
    it("movetextResult reads the trailing terminator", () => {
        expect(movetextResult("1. e4 e5 1-0")).toBe("1-0");
        expect(movetextResult("1. e4 e5")).toBeNull();
        expect(movetextResult("1. e4 e5 1/2-1/2")).toBe("1/2-1/2");
    });

    it("isPlaceholder recognizes empty/? /*", () => {
        expect(isPlaceholder("")).toBe(true);
        expect(isPlaceholder("?")).toBe(true);
        expect(isPlaceholder("????.??.??")).toBe(true);
        expect(isPlaceholder("Novak")).toBe(false);
    });
});

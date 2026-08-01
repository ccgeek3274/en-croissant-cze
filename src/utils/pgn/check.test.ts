import { describe, expect, it } from "vitest";
import {
    type ArtifactsCard,
    type DiacriticsCard,
    distinctTagValues,
    type DuplicatesCard,
    type EventCard,
    isPlaceholder,
    movetextResult,
    pgncheck,
    removeGameVariations,
    type ResultCard,
    setGameTag,
    stripGameDiacritics,
    syncGameResult,
    type TeamsCard,
    type VariationsCard,
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

function card<T>(games: string[], id: string, opts?: { isMatch?: boolean }): T {
    return pgncheck(games, opts).cards.find((c) => c.id === id) as T;
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
    it("tallies removable annotations per class and per game (no variations)", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4! e5 $1 {comment} 2. Nf3 Nc6 *",
        );
        const c = card<ArtifactsCard>([g], "artifacts");
        expect(c.status).toBe("warn");
        expect(c.affected).toBe(1);
        expect(c.totals.comments).toBe(1);
        expect(c.totals.nags).toBe(1);
        expect(c.totals.glyphs).toBe(1);
    });
});

describe("pgncheck — variations", () => {
    it("routes a variation game to the variations card, not artifacts", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 2. Nf3 (2. Bc4 Bc5) Nc6 *",
        );
        expect(card<ArtifactsCard>([g], "artifacts").affected).toBe(0);
        const v = card<VariationsCard>([g], "variations");
        expect(v.affected).toBe(1);
        expect(v.games[0].info.hasVariations).toBe(true);
        expect(v.games[0].info.losesLongerLine).toBe(false);
    });

    it("flags a variation that runs longer than the main line", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 2. Nf3 (2. Bc4 Bc5 3. d4 exd4 4. c3 dxc3) Nc6 *",
        );
        const info = card<VariationsCard>([g], "variations").games[0].info;
        expect(info.mainLinePlies).toBe(4);
        expect(info.longestPlies).toBe(8);
        expect(info.losesLongerLine).toBe(true);
    });

    it("removeGameVariations keeps the main line and drops the variation", () => {
        const g = game(
            { White: "A", Black: "B", Result: "1-0", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 2. Nf3 (2. Bc4 Bc5) Nc6 1-0",
        );
        const out = removeGameVariations(g);
        expect(out).not.toContain("Bc4");
        expect(out).toContain("Nc6");
        expect(out).toContain("1-0");
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

describe("pgncheck — match checks", () => {
    const mk = (board: number, whiteTeam: string, blackTeam: string, event = "Liga") =>
        game({
            Event: event,
            Round: `1.${board}`,
            Board: String(board),
            WhiteTeam: whiteTeam,
            BlackTeam: blackTeam,
            White: `W${board}`,
            Black: `B${board}`,
            Result: "*",
            Date: "2026.01.01",
        });

    it("omits event/teams unless isMatch", () => {
        expect(pgncheck([CLEAN]).cards.find((c) => c.id === "event")).toBeUndefined();
        expect(
            pgncheck([CLEAN], { isMatch: true }).cards.find((c) => c.id === "event"),
        ).toBeDefined();
    });

    it("passes a uniform Event and warns on differing ones", () => {
        const ok = card<EventCard>([mk(1, "X", "Y"), mk(2, "Y", "X")], "event", { isMatch: true });
        expect(ok.uniform).toBe(true);
        expect(ok.status).toBe("ok");

        const bad = card<EventCard>([mk(1, "X", "Y"), mk(2, "Y", "X", "Jiné")], "event", {
            isMatch: true,
        });
        expect(bad.uniform).toBe(false);
        expect(bad.status).toBe("warn");
    });

    it("flags a team-alternation violation", () => {
        // Odd boards expect X on white, even boards Y; board 3 breaks it.
        const games = [mk(1, "X", "Y"), mk(2, "Y", "X"), mk(3, "Y", "X"), mk(5, "X", "Y")];
        const teams = card<TeamsCard>(games, "teams", { isMatch: true });
        expect(teams.checkable).toBe(true);
        expect(teams.teamOdd).toBe("X");
        expect(teams.teamEven).toBe("Y");
        expect(teams.violations.map((g) => g.index)).toEqual([2]);
    });

    it("reports teams as not checkable without board/team info", () => {
        const teams = card<TeamsCard>([CLEAN], "teams", { isMatch: true });
        expect(teams.checkable).toBe(false);
        expect(teams.status).toBe("unknown");
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
        const a = game({
            White: "A",
            Black: "B",
            Round: "1.1",
            Result: "1-0",
            Event: "E",
            Date: "2026.01.01",
        });
        const b = game({
            White: "C",
            Black: "D",
            Round: "1.2",
            Result: "0-1",
            Event: "E",
            Date: "2026.01.01",
        });
        expect(card<DuplicatesCard>([a, b], "duplicates").affected).toBe(0);
    });
});

describe("tags editor helpers", () => {
    it("distinctTagValues counts, flags placeholders and sorts by frequency", () => {
        const a = game({ Event: "Liga", White: "A", Black: "B", Result: "*", Date: "2026.01.01" });
        const b = game({ Event: "Liga", White: "C", Black: "D", Result: "*", Date: "2026.01.01" });
        const c = game({ Event: "?", White: "E", Black: "F", Result: "*", Date: "2026.01.01" });
        const vals = distinctTagValues([a, b, c], "Event");
        expect(vals[0]).toMatchObject({ value: "Liga", count: 2 });
        expect(vals[0].indices).toEqual([0, 1]);
        expect(vals.find((v) => v.value === "?")?.suspicious).toBe(true);
    });

    it("setGameTag sets a tag and syncs the Result terminator", () => {
        const g = game(
            { White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" },
            "1. e4 e5 *",
        );
        const out = setGameTag(g, "Result", "1-0");
        expect(out).toContain('[Result "1-0"]');
        expect(out).toContain("1. e4 e5 1-0");
    });

    it("setGameTag adds a missing tag", () => {
        const g = game({ White: "A", Black: "B", Result: "*", Event: "E", Date: "2026.01.01" });
        expect(setGameTag(g, "Round", "2.3")).toContain('[Round "2.3"]');
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

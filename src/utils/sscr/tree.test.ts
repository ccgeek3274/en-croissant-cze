import { describe, expect, it } from "vitest";
import { splitPgnGames } from "@/utils/pgn/tags";
import { competitionXml, parseFixture } from "./__fixtures__";
import { buildManifest } from "./manifest";
import { buildSkeleton, skeletonToPgn } from "./skeleton";
import { allGameNodes, buildTree, findScope, formatScore } from "./tree";

function games(): string[] {
    return splitPgnGames(skeletonToPgn(buildSkeleton(parseFixture(), { eloSource: "fide" })));
}

function manifest() {
    return buildManifest(parseFixture(), { fileName: "3005.XML", xml: competitionXml });
}

function tree() {
    return buildTree(games(), manifest());
}

describe("buildTree", () => {
    it("mirrors the competition's shape", () => {
        const t = tree();
        expect(t.name).toBe("Krajská soutěž SŠS 2025/26 - skupina A");
        expect(t.rounds.map((r) => r.roundNr)).toEqual([1, 6, 8, 10]);
        expect(t.rounds[0].matches).toHaveLength(6);
        expect(t.rounds[0].matches[0].games).toHaveLength(8);
        expect(t.strays).toEqual([]);
    });

    it("takes round dates from the manifest", () => {
        expect(tree().rounds[0].date).toBe("2025-10-12");
    });

    it("reads team names off board 1, home first", () => {
        const match = tree().rounds[0].matches[0];
        expect(match.homeTeam).toBe("ŠK KDJS Sedlčany A");
        expect(match.awayTeam).toBe("Klokani z Kralup");
    });

    it("adds up the match score from the games' results", () => {
        // <results> in the XML says 2.5:5.5 for round 1, match 1.
        const match = tree().rounds[0].matches[0];
        expect([match.homeScore, match.awayScore]).toEqual([2.5, 5.5]);
    });

    it("leaves an unplayed round at 0:0", () => {
        const match = tree().rounds[3].matches[0];
        expect(match.roundNr).toBe(10);
        expect([match.homeScore, match.awayScore]).toEqual([0, 0]);
    });

    it("counts moves, results, placeholders and forfeits per level", () => {
        const t = tree();
        expect(t.stats).toMatchObject({ total: 192, withMoves: 0 });
        // Round 1 is fully played, with no forfeits.
        expect(t.rounds[0].stats).toMatchObject({
            total: 48,
            decided: 48,
            placeholders: 0,
            forfeits: 0,
        });
        // Round 10 is drawn but not played: every game is a placeholder.
        expect(t.rounds[3].stats).toMatchObject({ total: 48, decided: 0, placeholders: 48 });
        // Round 6 has the forfeited boards.
        expect(t.rounds[1].stats.forfeits).toBe(6);
    });

    it("counts moves once a game has them", () => {
        const list = games();
        list[0] = `${list[0].replace(/\n\n[^\n]*$/, "")}\n\n1. d4 Nf6 1/2-1/2`;
        const t = buildTree(list, manifest());
        expect(t.stats.withMoves).toBe(1);
        expect(t.rounds[0].matches[0].stats.withMoves).toBe(1);
        expect(t.rounds[0].matches[0].games[0].hasMoves).toBe(true);
    });

    it("keeps a game with a foreign Round tag visible as a stray", () => {
        const stray = '[Event "Přátelák"]\n[Round "?"]\n[White "A, A"]\n[Black "B, B"]\n\n1. e4 *';
        const t = buildTree([...games(), stray], manifest());
        expect(t.strays).toHaveLength(1);
        expect(t.strays[0]).toMatchObject({ white: "A, A", black: "B, B", index: 192 });
        expect(t.stats.total).toBe(193);
    });

    it("works without a manifest", () => {
        const t = buildTree(games());
        expect(t.rounds).toHaveLength(4);
        expect(t.rounds[0].date).toBe("");
        expect(t.rounds[0].matches[0].homeTeam).toBe("ŠK KDJS Sedlčany A");
    });

    it("names a match with no games at all from the manifest's draw", () => {
        const t = buildTree([], manifest());
        expect(t.rounds).toEqual([]);
        expect(t.stats.total).toBe(0);
    });
});

describe("formatScore", () => {
    it("writes halves with one decimal and whole points bare", () => {
        expect(formatScore(4, 4)).toBe("4:4");
        expect(formatScore(4.5, 3.5)).toBe("4.5:3.5");
        expect(formatScore(0, 0)).toBe("0:0");
    });
});

describe("findScope", () => {
    it("covers all four levels", () => {
        const t = tree();
        expect(findScope(t, "competition")).toMatchObject({ label: t.name });
        expect(findScope(t, "competition")!.indices).toHaveLength(192);
        expect(findScope(t, "1")).toMatchObject({ label: "1. kolo" });
        expect(findScope(t, "1")!.indices).toHaveLength(48);
        expect(findScope(t, "1.1")).toMatchObject({
            label: "ŠK KDJS Sedlčany A – Klokani z Kralup",
        });
        expect(findScope(t, "1.1")!.indices).toHaveLength(8);
        expect(findScope(t, "1.1.1")).toEqual({
            id: "1.1.1",
            label: "Šimák, Roman – Hánl, František",
            indices: [0],
        });
    });

    it("finds a stray", () => {
        const stray = '[Event "Přátelák"]\n[Round "?"]\n[White "A, A"]\n[Black "B, B"]\n\n1. e4 *';
        const t = buildTree([...games(), stray], manifest());
        expect(findScope(t, "stray-192")).toEqual({
            id: "stray-192",
            label: "A, A – B, B",
            indices: [192],
        });
    });

    it("returns null for an unknown id", () => {
        expect(findScope(tree(), "99.9.9")).toBeNull();
    });
});

describe("allGameNodes", () => {
    it("lists every game in (round, match, board) order", () => {
        const nodes = allGameNodes(tree());
        expect(nodes).toHaveLength(192);
        expect(nodes.map((n) => n.id).slice(0, 3)).toEqual(["1.1.1", "1.1.2", "1.1.3"]);
        expect(nodes.at(-1)!.id).toBe("10.6.8");
    });
});

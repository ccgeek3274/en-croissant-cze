import { describe, expect, it } from "vitest";
import { getTag, splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { competitionXml, parseFixture } from "./__fixtures__";
import {
    buildSscrEvent,
    buildSscrExport,
    DEFAULT_EXPORT_OPTIONS,
    defaultEventPrefix,
    exportPreflight,
    labelMapFrom,
    readGameFacts,
    type SscrExportOptions,
    SSCR_TAGS,
    toSscrGame,
} from "./export";
import { buildManifest } from "./manifest";
import { buildSkeleton, skeletonToPgn } from "./skeleton";

const LABELS = new Map([
    ["ŠK KDJS Sedlčany A", "Sedlčany A"],
    ["Klokani z Kralup", "Kralupy B"],
    ["Dubno A", "Dubno A"],
    ["TJ Hostivice A", "Hostivice A"],
]);

const OPTS: SscrExportOptions = {
    prefix: "KSA SSS 25/26",
    labelByTeamName: LABELS,
    ...DEFAULT_EXPORT_OPTIONS,
};

function games(): string[] {
    return splitPgnGames(skeletonToPgn(buildSkeleton(parseFixture(), { eloSource: "fide" })));
}

function find(list: string[], round: string): string {
    const g = list.find((x) => splitGame(x).tags.map.Round === round);
    if (!g) throw new Error(`no game ${round}`);
    return g;
}

function withMoves(game: string, moves: string): string {
    const { tags } = splitGame(game);
    const lines = tags.order.map((t) => `[${t} "${tags.map[t]}"]`).join("\n");
    return `${lines}\n\n${moves}`;
}

describe("defaultEventPrefix", () => {
    it("suggests an abbreviation plus the season", () => {
        const prefix = defaultEventPrefix("Krajská soutěž SŠS 2025/26 - skupina A", 2025);
        expect(prefix).toContain("25/26");
        expect(prefix).not.toBe("25/26");
    });

    it("copes with an unknown season", () => {
        expect(defaultEventPrefix("Liga", null)).not.toContain("undefined");
    });
});

describe("buildSscrEvent", () => {
    it("joins prefix and the two labels the way the bulletin does", () => {
        expect(buildSscrEvent("KSA SSS 25/26", "Sedlcany A", "Kralupy B")).toBe(
            "KSA SSS 25/26 Sedlcany A-Kralupy B",
        );
    });

    it("collapses stray whitespace", () => {
        expect(buildSscrEvent(" KSA  ", "A", "B")).toBe("KSA A-B");
    });
});

describe("readGameFacts", () => {
    it("reads home and away off the board parity", () => {
        const list = games();
        expect(readGameFacts(find(list, "1.1.1"))).toMatchObject({
            roundNr: 1,
            boardNr: 1,
            homeTeam: "ŠK KDJS Sedlčany A",
            awayTeam: "Klokani z Kralup",
        });
        // Board 2: home plays Black, but it is still the home team.
        expect(readGameFacts(find(list, "1.1.2"))).toMatchObject({
            homeTeam: "ŠK KDJS Sedlčany A",
            awayTeam: "Klokani z Kralup",
        });
    });

    it("marks a forfeit nobody played", () => {
        const list = games();
        expect(readGameFacts(find(list, "6.2.5"))).toMatchObject({
            forfeit: true,
            emptyForfeit: true,
        });
        // Round 8 boards 6/7 were played and only scored as forfeits.
        expect(readGameFacts(find(list, "8.5.6"))).toMatchObject({
            forfeit: true,
            emptyForfeit: false,
        });
    });

    it("ignores a game that is not part of the draw", () => {
        expect(readGameFacts('[Round "?"]\n[White "A"]\n\n*')).toBeNull();
    });
});

describe("toSscrGame", () => {
    it("emits exactly the bulletin's tags, in order", () => {
        const game = toSscrGame(withMoves(find(games(), "1.1.1"), "1. d4 Nf6 1/2-1/2"), OPTS)!;
        const { tags, movetext } = splitGame(game.text);
        expect(tags.order).toEqual([
            "Event",
            "Date",
            "Round",
            "White",
            "Black",
            "Result",
            "WhiteElo",
            "BlackElo",
        ]);
        expect(tags.order.every((t) => SSCR_TAGS.includes(t))).toBe(true);
        expect(movetext).toBe("1. d4 Nf6 1/2-1/2");
    });

    it("shortens Event to prefix + team labels, and drops the match from Round", () => {
        const { tags } = splitGame(toSscrGame(find(games(), "1.1.1"), OPTS)!.text);
        expect(tags.map.Event).toBe("KSA SSS 25/26 Sedlcany A-Kralupy B");
        expect(tags.map.Round).toBe("1.1");
        expect(splitGame(toSscrGame(find(games(), "1.1.8"), OPTS)!.text).tags.map.Round).toBe(
            "1.8",
        );
    });

    it("strips diacritics everywhere", () => {
        const { tags } = splitGame(toSscrGame(find(games(), "1.1.1"), OPTS)!.text);
        expect(tags.map.White).toBe("Simak, Roman");
        expect(tags.map.Black).toBe("Hanl, Frantisek");
        expect(tags.map.Event).not.toMatch(/[ěščřžýáíéůúňť]/i);
    });

    it("keeps diacritics when asked to", () => {
        const { tags } = splitGame(
            toSscrGame(find(games(), "1.1.1"), { ...OPTS, stripDiacritics: false })!.text,
        );
        expect(tags.map.White).toBe("Šimák, Roman");
    });

    it("leaves the team tags, ids and Board behind", () => {
        const text = toSscrGame(find(games(), "1.1.1"), OPTS)!.text;
        for (const tag of ["WhiteTeam", "BlackTeam", "WhiteCzeId", "Board", "EventDate", "Site"]) {
            expect(text).not.toContain(`[${tag} `);
        }
    });

    it("drops a forfeit nobody played, and keeps one that was", () => {
        expect(toSscrGame(find(games(), "6.2.5"), OPTS)).toBeNull();
        expect(toSscrGame(find(games(), "8.5.6"), OPTS)).not.toBeNull();
    });

    it("keeps every forfeit when told to", () => {
        const kept = toSscrGame(find(games(), "6.2.5"), { ...OPTS, dropEmptyForfeits: false })!;
        expect(splitGame(kept.text).tags.map.Black).toBe("?");
    });

    it("falls back to the full team name when there is no label", () => {
        const { tags } = splitGame(toSscrGame(find(games(), "1.2.1"), OPTS)!.text);
        // Team 2 (Dubno A) is labelled, team 11 (Hostivice A) is too; team 5 is not.
        expect(tags.map.Event.startsWith("KSA SSS 25/26 ")).toBe(true);
    });
});

describe("buildSscrExport", () => {
    it("projects a whole competition and reports what it dropped", () => {
        const result = buildSscrExport(games(), OPTS);
        // 192 skeleton games minus the 7 forfeits nobody played.
        expect(result.included).toBe(185);
        expect(result.dropped).toBe(7);
        expect(splitPgnGames(result.pgn)).toHaveLength(185);
    });

    it("produces a parseable PGN whose first game is round 1 board 1", () => {
        const parsed = splitPgnGames(buildSscrExport(games(), OPTS).pgn);
        expect(getTag(splitGame(parsed[0]).tags, "Round")).toBe("1.1");
    });

    it("returns an empty string for an empty scope", () => {
        expect(buildSscrExport([], OPTS)).toEqual({ pgn: "", included: 0, dropped: 0 });
    });
});

describe("exportPreflight", () => {
    it("counts what would go out incomplete", () => {
        const report = exportPreflight(games(), OPTS);
        expect(report.total).toBe(185);
        expect(report.withoutMoves).toBe(185);
        expect(report.droppedForfeits).toBe(7);
        // Round 10 is drawn but not played.
        expect(report.placeholderNames).toBe(48);
        expect(report.withoutResult).toBe(48);
        expect(report.clean).toBe(false);
    });

    it("lists the matches that have no moves at all", () => {
        const list = games();
        const withOne = list.map((g) =>
            splitGame(g).tags.map.Round === "1.1.1" ? withMoves(g, "1. d4 1/2-1/2") : g,
        );
        const report = exportPreflight(withOne, OPTS);
        expect(report.matchesWithoutMoves).not.toContain("1.1");
        expect(report.matchesWithoutMoves).toContain("1.2");
        expect(report.matchesWithoutMoves).toHaveLength(23);
    });

    it("names the teams with no short label", () => {
        const report = exportPreflight(games(), OPTS);
        expect(report.unlabelledTeams).toContain("ŠK Rakovník A");
        expect(report.unlabelledTeams).not.toContain("ŠK KDJS Sedlčany A");
    });

    it("catches two matches that would share one Event", () => {
        // Everything unlabelled collapses onto the full names, so give two different
        // matches the same pair of labels to force the collision.
        const collide = new Map(LABELS);
        for (const name of [
            "Dubno A",
            "TJ Hostivice A",
            "Český lev Kolešovice B",
            "Cayman Pharma Neratovice B",
        ]) {
            collide.set(name, "X");
        }
        const report = exportPreflight(games(), { ...OPTS, labelByTeamName: collide });
        expect(report.duplicateEvents).toContain("KSA SSS 25/26 X-X");
    });

    it("is clean once everything is in place", () => {
        const played = games()
            .filter((g) => !splitGame(g).tags.map.Round.startsWith("10."))
            .filter((g) => splitGame(g).tags.map.White !== "?")
            .filter((g) => splitGame(g).tags.map.Black !== "?")
            .map((g) => withMoves(g, `1. d4 ${splitGame(g).tags.map.Result}`));
        const labels = new Map(parseFixture().teams.map((t) => [t.name, `T${t.no}`]));
        const report = exportPreflight(played, { ...OPTS, labelByTeamName: labels });
        expect(report).toMatchObject({
            withoutMoves: 0,
            withoutResult: 0,
            placeholderNames: 0,
            unlabelledTeams: [],
            duplicateEvents: [],
            clean: true,
        });
    });
});

describe("labelMapFrom", () => {
    it("takes only the labels the leader actually set", () => {
        const manifest = buildManifest(parseFixture(), {
            fileName: "3005.XML",
            xml: competitionXml,
        });
        expect(labelMapFrom(manifest).size).toBe(0);
        manifest.teams[0].label = "Sedlčany A";
        expect(labelMapFrom(manifest)).toEqual(new Map([["ŠK KDJS Sedlčany A", "Sedlčany A"]]));
    });
});

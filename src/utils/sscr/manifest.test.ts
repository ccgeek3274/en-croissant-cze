import { describe, expect, it } from "vitest";
import { competitionXml, parseFixture } from "./__fixtures__";
import {
    buildManifest,
    contentHash,
    manifestPathFor,
    mergeManifest,
    parseManifest,
    serializeManifest,
    siteByTeamNo,
} from "./manifest";

function fixtureManifest() {
    return buildManifest(parseFixture(), {
        fileName: "3005.XML",
        xml: competitionXml,
        importedAt: "2026-03-15T10:00:00.000Z",
    });
}

describe("manifestPathFor", () => {
    it("swaps the .pgn extension for the sidecar suffix", () => {
        expect(manifestPathFor("/docs/KSA.pgn")).toBe("/docs/KSA.competition.json");
        expect(manifestPathFor("/docs/KSA.PGN")).toBe("/docs/KSA.competition.json");
    });

    it("leaves a path without the extension alone", () => {
        expect(manifestPathFor("/docs/KSA")).toBe("/docs/KSA.competition.json");
    });
});

describe("contentHash", () => {
    it("is stable and content-sensitive", () => {
        expect(contentHash("abc")).toBe(contentHash("abc"));
        expect(contentHash("abc")).not.toBe(contentHash("abd"));
        expect(contentHash("")).toHaveLength(8);
    });
});

describe("buildManifest", () => {
    it("records the source stamp", () => {
        const m = fixtureManifest();
        expect(m.version).toBe(1);
        expect(m.source).toMatchObject({
            fileName: "3005.XML",
            importedAt: "2026-03-15T10:00:00.000Z",
            xmlId: "3318",
        });
        expect(m.source.hash).toBe(contentHash(competitionXml));
    });

    it("copies the competition header", () => {
        expect(fixtureManifest().competition).toEqual({
            name: "Krajská soutěž SŠS 2025/26 - skupina A",
            year: 2025,
            boardCount: 8,
            teamCount: 12,
            compId: null,
        });
    });

    it("lists teams with empty label/site so the leader can fill them in", () => {
        const m = fixtureManifest();
        expect(m.teams).toHaveLength(12);
        expect(m.teams[0]).toEqual({ no: 1, name: "ŠK KDJS Sedlčany A", label: null, site: null });
    });

    it("stores the draw round by round", () => {
        const m = fixtureManifest();
        expect(m.rounds.map((r) => r.no)).toEqual([1, 6, 8, 10]);
        expect(m.rounds[0]).toEqual({
            no: 1,
            date: "2025-10-12",
            matches: [
                { no: 1, homeTeamNo: 1, awayTeamNo: 12 },
                { no: 2, homeTeamNo: 2, awayTeamNo: 11 },
                { no: 3, homeTeamNo: 3, awayTeamNo: 10 },
                { no: 4, homeTeamNo: 4, awayTeamNo: 9 },
                { no: 5, homeTeamNo: 5, awayTeamNo: 8 },
                { no: 6, homeTeamNo: 6, awayTeamNo: 7 },
            ],
        });
    });

    it("takes the options it is given", () => {
        const m = buildManifest(
            parseFixture(),
            { fileName: "x.xml", xml: "<x/>" },
            { eloSource: "cze", eventPrefix: "KSA SSS 25/26", compId: 3005 },
        );
        expect(m.options).toEqual({
            eloSource: "cze",
            eventPrefix: "KSA SSS 25/26",
            eventPattern: null,
            filePattern: null,
        });
        expect(m.competition.compId).toBe(3005);
    });
});

describe("mergeManifest", () => {
    it("keeps the leader's labels, venues, compId and options across a re-sync", () => {
        const previous = fixtureManifest();
        previous.teams[0].label = "Sedlčany A";
        previous.teams[0].site = "Sedlčany";
        previous.competition.compId = 3005;
        previous.options = {
            eloSource: "cze",
            eventPrefix: "KSA SSS 25/26",
            eventPattern: null,
            filePattern: "{soutez}-{kolo}",
        };

        const next = buildManifest(parseFixture(), {
            fileName: "3005-po-10-kole.XML",
            xml: `${competitionXml} `,
            importedAt: "2026-03-20T10:00:00.000Z",
        });

        const merged = mergeManifest(previous, next);
        // Fresh from the new file:
        expect(merged.source.fileName).toBe("3005-po-10-kole.XML");
        expect(merged.source.importedAt).toBe("2026-03-20T10:00:00.000Z");
        expect(merged.rounds).toEqual(next.rounds);
        // Carried over:
        expect(merged.teams[0]).toEqual({
            no: 1,
            name: "ŠK KDJS Sedlčany A",
            label: "Sedlčany A",
            site: "Sedlčany",
        });
        expect(merged.competition.compId).toBe(3005);
        expect(merged.options).toEqual({
            eloSource: "cze",
            eventPrefix: "KSA SSS 25/26",
            eventPattern: null,
            filePattern: "{soutez}-{kolo}",
        });
    });

    it("drops customisation for a team that left the competition", () => {
        const previous = fixtureManifest();
        previous.teams[0].label = "Sedlčany A";
        const next = buildManifest(parseFixture(), { fileName: "x", xml: "<x/>" });
        next.teams = next.teams.filter((t) => t.no !== 1);
        expect(mergeManifest(previous, next).teams.some((t) => t.no === 1)).toBe(false);
    });
});

describe("siteByTeamNo", () => {
    it("emits only the teams with an explicit venue, empty string included", () => {
        const m = fixtureManifest();
        m.teams[0].site = "Sedlčany";
        m.teams[1].site = "";
        expect(siteByTeamNo(m)).toEqual({ 1: "Sedlčany", 2: "" });
    });
});

describe("parseManifest / serializeManifest", () => {
    it("round-trips", () => {
        const m = fixtureManifest();
        expect(parseManifest(serializeManifest(m))).toEqual(m);
    });

    it("returns null for anything that is not a manifest", () => {
        expect(parseManifest("not json")).toBeNull();
        expect(parseManifest("{}")).toBeNull();
        expect(parseManifest(JSON.stringify({ version: 99 }))).toBeNull();
    });
});

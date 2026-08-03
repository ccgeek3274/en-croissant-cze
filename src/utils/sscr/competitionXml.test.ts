import { describe, expect, it } from "vitest";
import { competitionXml, parseFixture } from "./__fixtures__";
import { indexRoster, parseCompetitionXml, parseSchedule, roundFillState } from "./competitionXml";

describe("parseSchedule", () => {
    it("splits the fixed-width pairing string", () => {
        expect(parseSchedule(" 112 211 310 4 9 5 8 6 7")).toEqual([
            { rid: " 112", home: 1, away: 12 },
            { rid: " 211", home: 2, away: 11 },
            { rid: " 310", home: 3, away: 10 },
            { rid: " 4 9", home: 4, away: 9 },
            { rid: " 5 8", home: 5, away: 8 },
            { rid: " 6 7", home: 6, away: 7 },
        ]);
    });

    it("handles two-digit team numbers on both sides", () => {
        expect(parseSchedule("1211")).toEqual([{ rid: "1211", home: 12, away: 11 }]);
    });

    it("ignores a trailing partial token", () => {
        expect(parseSchedule(" 112 21")).toEqual([{ rid: " 112", home: 1, away: 12 }]);
    });
});

describe("parseCompetitionXml", () => {
    it("reads the tournament header", () => {
        const comp = parseFixture();
        expect(comp.info.name).toBe("Krajská soutěž SŠS 2025/26 - skupina A");
        expect(comp.info.teamCount).toBe(12);
        // <players> is boards per match, not a player count.
        expect(comp.info.boardCount).toBe(8);
        expect(comp.info.year).toBe(2025);
    });

    it("reads the teams in numbering order", () => {
        const comp = parseFixture();
        expect(comp.teams).toHaveLength(12);
        expect(comp.teams[0]).toEqual({ no: 1, name: "ŠK KDJS Sedlčany A" });
        expect(comp.teams[11]).toEqual({ no: 12, name: "Klokani z Kralup" });
    });

    it("indexes the roster by (team, desk)", () => {
        const comp = parseFixture();
        const roster = indexRoster(comp.roster);
        const stluka = roster.get("2/1");
        expect(stluka).toMatchObject({
            teamNo: 2,
            desk: 1,
            czeId: "342",
            rawName: "Stluka Petr",
            czeElo: 2133,
            fideElo: 2126,
            memo: "Z,ZK",
        });
    });

    it("derives one match per schedule token, in schedule order", () => {
        const comp = parseFixture();
        const round1 = comp.rounds.find((r) => r.roundNr === 1)!;
        expect(round1.date).toBe("2025-10-12");
        expect(round1.matches.map((m) => [m.matchNr, m.homeTeamNo, m.awayTeamNo])).toEqual([
            [1, 1, 12],
            [2, 2, 11],
            [3, 3, 10],
            [4, 4, 9],
            [5, 5, 8],
            [6, 6, 7],
        ]);
        expect(round1.matches.every((m) => m.boards.length === 8)).toBe(true);
    });

    it("numbers boards by document order within a (round, rid) group", () => {
        const comp = parseFixture();
        const match = comp.rounds.find((r) => r.roundNr === 1)!.matches[0];
        expect(match.rid).toBe(" 112");
        expect(match.boards.map((b) => [b.boardNr, b.homeDesk, b.awayDesk])).toEqual([
            [1, 1, 3],
            [2, 2, 4],
            [3, 3, 5],
            [4, 4, 7],
            [5, 5, 8],
            [6, 6, 9],
            [7, 7, 10],
            [8, 8, 16],
        ]);
    });

    it("carries the match score from <results>", () => {
        const comp = parseFixture();
        const match = comp.rounds.find((r) => r.roundNr === 1)!.matches[0];
        expect([match.homeScore, match.awayScore]).toEqual([2.5, 5.5]);
    });

    it("flags a forfeit and the missing player behind it", () => {
        const comp = parseFixture();
        // Round 6, match 2: Neratovice B fielded nobody on boards 5–8.
        const match = comp.rounds.find((r) => r.roundNr === 6)!.matches[1];
        expect([match.homeTeamNo, match.awayTeamNo]).toEqual([10, 8]);
        const board5 = match.boards[4];
        expect(board5.awayDesk).toBe(0);
        expect(board5.home).toEqual({ raw: "1F", value: 1, forfeit: true });
        expect(board5.away).toEqual({ raw: "0F", value: 0, forfeit: true });
    });

    it("keeps the rating score (sct) when it differs from the match score", () => {
        const comp = parseFixture();
        // Round 8, match 5 (Kolešovice B – Řevnice): boards 6 and 7 were played but
        // the points are awarded by forfeit.
        const match = comp.rounds.find((r) => r.roundNr === 8)!.matches[4];
        expect([match.homeTeamNo, match.awayTeamNo]).toEqual([3, 6]);
        expect(match.boards[5].home.raw).toBe("1F");
        expect(match.boards[5].homeRated).toEqual({ raw: "0.5", value: 0.5, forfeit: false });
        expect(match.boards[5].awayRated).toEqual({ raw: "0.5", value: 0.5, forfeit: false });
        expect(match.boards[6].homeRated).toEqual({ raw: "1", value: 1, forfeit: false });
        // A normal board carries no sct at all.
        expect(match.boards[0].homeRated).toBeNull();
    });

    it("reports no errors on a well-formed file", () => {
        const { issues } = parseCompetitionXml(competitionXml);
        expect(issues.filter((i) => i.level === "error")).toEqual([]);
    });

    it("rejects XML that is not a competition file", () => {
        const res = parseCompetitionXml("<foo><bar/></foo>");
        expect(res.competition).toBeNull();
        expect(res.issues[0]).toMatchObject({ level: "error", code: "NotACompetitionXml" });
    });

    it("reports unreadable XML instead of throwing", () => {
        const res = parseCompetitionXml("<chess><tournament>");
        expect(res.competition).toBeNull();
        expect(res.issues[0].level).toBe("error");
    });

    it("warns when a schedule token has no games", () => {
        const xml = `<chess><tournament name="basic">
            <info><id>1</id><name>T</name><teams>2</teams><players>2</players></info>
            <team><no>1</no><name>A</name></team>
            <team><no>2</no><name>B</name></team>
            <round><no>1</no><term>2025-01-01</term><schedule> 1 2</schedule></round>
        </tournament></chess>`;
        const { competition, issues } = parseCompetitionXml(xml);
        expect(competition?.rounds[0].matches[0].boards).toEqual([]);
        expect(issues.map((i) => i.code)).toContain("MatchWithoutGames");
    });
});

describe("roundFillState", () => {
    it("separates played rounds from not-yet-played ones", () => {
        const comp = parseFixture();
        const state = Object.fromEntries(comp.rounds.map((r) => [r.roundNr, roundFillState(r)]));
        expect(state).toEqual({ 1: "complete", 6: "complete", 8: "complete", 10: "empty" });
    });
});

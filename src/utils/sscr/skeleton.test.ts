import { describe, expect, it } from "vitest";
import { getTag, splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { parseFixture, swissManagerPgn } from "./__fixtures__";
import {
    boardOutcome,
    buildSkeleton,
    formatRoundTag,
    type GameKey,
    parseRoundTag,
    type SkeletonGame,
    skeletonToPgn,
    toPgnDate,
} from "./skeleton";

const OPTS = { eloSource: "fide" as const };

function skeleton(): SkeletonGame[] {
    return buildSkeleton(parseFixture(), OPTS);
}

function byRound(games: SkeletonGame[], round: string): SkeletonGame {
    const g = games.find((x) => formatRoundTag(x.key) === round);
    if (!g) throw new Error(`no game ${round}`);
    return g;
}

describe("Round tag as the game key", () => {
    it("round-trips", () => {
        const key: GameKey = { roundNr: 11, matchNr: 6, boardNr: 8 };
        expect(formatRoundTag(key)).toBe("11.6.8");
        expect(parseRoundTag("11.6.8")).toEqual(key);
        expect(parseRoundTag(" 1.1.1 ")).toEqual({ roundNr: 1, matchNr: 1, boardNr: 1 });
    });

    it("rejects anything that is not a three-level round", () => {
        expect(parseRoundTag("1.1")).toBeNull();
        expect(parseRoundTag("1")).toBeNull();
        expect(parseRoundTag("?")).toBeNull();
        expect(parseRoundTag(undefined)).toBeNull();
    });
});

describe("toPgnDate", () => {
    it("converts ISO to PGN dots", () => {
        expect(toPgnDate("2025-10-12")).toBe("2025.10.12");
    });
    it("passes anything else through", () => {
        expect(toPgnDate("")).toBe("");
        expect(toPgnDate("2025")).toBe("2025");
        expect(toPgnDate(null)).toBe("");
    });
});

describe("boardOutcome", () => {
    const win = { value: 1, forfeit: false };
    const loss = { value: 0, forfeit: false };
    const draw = { value: 0.5, forfeit: false };

    it("reads the score from the home team's side and flips it on even boards", () => {
        expect(boardOutcome(win, loss, true).result).toBe("1-0");
        expect(boardOutcome(win, loss, false).result).toBe("0-1");
        expect(boardOutcome(loss, win, true).result).toBe("0-1");
        expect(boardOutcome(loss, win, false).result).toBe("1-0");
        expect(boardOutcome(draw, draw, true).result).toBe("1/2-1/2");
    });

    it("treats 0:0 as not played", () => {
        expect(boardOutcome(loss, loss, true)).toEqual({
            result: "*",
            forfeit: false,
            decided: false,
        });
    });

    it("marks forfeits and still decides the point", () => {
        expect(
            boardOutcome({ value: 1, forfeit: true }, { value: 0, forfeit: true }, true),
        ).toEqual({ result: "1-0", forfeit: true, decided: true });
    });

    it("cannot express a double forfeit, but records that it is decided", () => {
        expect(
            boardOutcome({ value: 0, forfeit: true }, { value: 0, forfeit: true }, true),
        ).toEqual({ result: "*", forfeit: true, decided: true });
    });
});

describe("buildSkeleton", () => {
    it("emits one game per board of every match", () => {
        const games = skeleton();
        // 4 rounds × 6 matches × 8 boards
        expect(games).toHaveLength(192);
        expect(games.map((g) => formatRoundTag(g.key))[0]).toBe("1.1.1");
        expect(games.map((g) => formatRoundTag(g.key)).at(-1)).toBe("10.6.8");
    });

    it("fills the full header set on board 1 (home is White)", () => {
        const g = byRound(skeleton(), "1.1.1");
        expect(g.tags.map).toEqual({
            Event: "Krajská soutěž SŠS 2025/26 - skupina A",
            Site: "",
            Date: "2025.10.12",
            Round: "1.1.1",
            White: "Šimák, Roman",
            Black: "Hánl, František",
            Result: "1/2-1/2",
            WhiteTeam: "ŠK KDJS Sedlčany A",
            BlackTeam: "Klokani z Kralup",
            WhiteElo: "1889",
            BlackElo: "2160",
            WhiteCzeId: "41154",
            BlackCzeId: "31709",
            Board: "1",
            EventDate: "2025.10.12",
        });
    });

    it("swaps colours and team tags on even boards", () => {
        const g = byRound(skeleton(), "1.1.2");
        expect(g.tags.map.WhiteTeam).toBe("Klokani z Kralup");
        expect(g.tags.map.BlackTeam).toBe("ŠK KDJS Sedlčany A");
        expect(g.tags.map.White).toBe("Štursa, Jan");
        expect(g.tags.map.Black).toBe("Hlaváček, Ondřej");
    });

    it("takes national ratings when asked to", () => {
        const g = byRound(buildSkeleton(parseFixture(), { eloSource: "cze" }), "1.1.1");
        expect(g.tags.map.WhiteElo).toBe("1858");
        expect(g.tags.map.BlackElo).toBe("2110");
    });

    it("marks a forfeit and leaves the absent player unknown", () => {
        // Round 6, match 2, board 5: the away team fielded nobody.
        const g = byRound(skeleton(), "6.2.5");
        expect(g.tags.map.White).toBe("Gruber, Miloš");
        expect(g.tags.map.Black).toBe("?");
        expect(g.tags.map.Result).toBe("1-0");
        expect(g.tags.map.Termination).toBe("forfeit");
        expect(g.tags.map.BlackElo).toBeUndefined();
        expect(g.tags.map.BlackCzeId).toBeUndefined();
    });

    it("keeps the played result of a board whose point went by forfeit", () => {
        // Board 6 is even, so the home team (which won 1F:0F) is Black.
        const g = byRound(skeleton(), "8.5.6");
        expect(g.tags.map.Result).toBe("0-1");
        expect(g.tags.map.Termination).toBe("forfeit");
        expect(g.tags.map.RatedResult).toBe("1/2-1/2");
        // Board 7: same forfeit direction, and the game really did end that way →
        // nothing extra to record.
        expect(byRound(skeleton(), "8.5.7").tags.map.Result).toBe("1-0");
        expect(byRound(skeleton(), "8.5.7").tags.map.RatedResult).toBeUndefined();
    });

    it("uses placeholders for a match that has not been drawn up yet", () => {
        const g = byRound(skeleton(), "10.1.1");
        expect(g.tags.map.White).toBe("Domácí 1");
        expect(g.tags.map.Black).toBe("Hosté 1");
        expect(g.tags.map.Result).toBe("*");
        expect(g.tags.map.Termination).toBeUndefined();
        // Teams and the date are known from the draw even before the round is played.
        expect(g.tags.map.WhiteTeam).toBe("Klokani z Kralup");
        expect(g.tags.map.BlackTeam).toBe("TJ Hostivice A");
        expect(g.tags.map.Date).toBe("2026.03.15");
        // Board 2 flips the placeholders with the colours.
        expect(byRound(skeleton(), "10.1.2").tags.map.White).toBe("Hosté 2");
    });

    it("takes Site from the home team's venue", () => {
        const games = buildSkeleton(parseFixture(), {
            ...OPTS,
            siteByTeamNo: { 1: "Sedlčany", 12: "Kralupy" },
        });
        expect(byRound(games, "1.1.1").tags.map.Site).toBe("Sedlčany");
        // Even board — home is Black, but Site still follows the home team.
        expect(byRound(games, "1.1.2").tags.map.Site).toBe("Sedlčany");
        expect(byRound(games, "1.2.1").tags.map.Site).toBe("");
    });
});

describe("skeletonToPgn", () => {
    it("produces a PGN that parses back into the same games", () => {
        const games = skeleton();
        const parsed = splitPgnGames(skeletonToPgn(games));
        expect(parsed).toHaveLength(games.length);
        const first = splitGame(parsed[0]);
        expect(getTag(first.tags, "Round")).toBe("1.1.1");
        expect(first.tags.order[0]).toBe("Event");
        expect(first.movetext).toBe("1/2-1/2");
    });

    it("writes the result token as the movetext of an unplayed game", () => {
        const games = skeleton().filter((g) => g.key.roundNr === 10);
        expect(splitGame(splitPgnGames(skeletonToPgn(games))[0]).movetext).toBe("*");
    });
});

// ── The reverse-engineering guard ────────────────────────────────────────────
// Swiss-Manager exported its own PGN from the very same tournament. Every game it
// wrote must come out of our XML mapping identically — this is what pins the
// schedule → match-number order, the board order inside a (round, rid) group, the
// colour parity and the home-relative reading of the score.

type SmGame = Record<string, string>;

function readSwissManagerGames(): Map<string, SmGame> {
    const out = new Map<string, SmGame>();
    for (const block of splitPgnGames(swissManagerPgn)) {
        const { tags } = splitGame(block);
        out.set(tags.map.Round, tags.map);
    }
    return out;
}

describe("skeleton vs. Swiss-Manager's own PGN export", () => {
    const sm = readSwissManagerGames();
    const mine = new Map(skeleton().map((g) => [formatRoundTag(g.key), g.tags.map]));

    it("covers every game Swiss-Manager exported", () => {
        expect(sm.size).toBe(135);
        expect([...sm.keys()].filter((k) => !mine.has(k))).toEqual([]);
    });

    it("agrees on players, teams, date and result", () => {
        const diffs: string[] = [];
        for (const [round, theirs] of sm) {
            const ours = mine.get(round)!;
            for (const tag of ["Date", "White", "Black", "WhiteTeam", "BlackTeam", "Result"]) {
                if (ours[tag] !== theirs[tag]) {
                    diffs.push(`${round} ${tag}: ${ours[tag]} ≠ ${theirs[tag]}`);
                }
            }
        }
        expect(diffs).toEqual([]);
    });

    it("has the forfeited boards Swiss-Manager drops from its export", () => {
        const extra = [...mine.keys()].filter(
            (k) => !sm.has(k) && ["1", "6", "8"].includes(k.split(".")[0]),
        );
        expect(extra.sort()).toEqual([
            "6.2.5",
            "6.2.6",
            "6.2.7",
            "6.2.8",
            "6.3.8",
            "6.6.8",
            "8.5.6",
            "8.5.7",
            "8.5.8",
        ]);
        for (const k of extra) expect(mine.get(k)!.Termination).toBe("forfeit");
    });
});

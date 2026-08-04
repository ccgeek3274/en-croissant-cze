import { describe, expect, it } from "vitest";
import { splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { parseFixture } from "./__fixtures__";
import { buildSkeleton, formatRoundTag, type SkeletonGame, skeletonToPgn } from "./skeleton";
import { applySync, gamesToFile, hasMoves, isUninformative, planSync } from "./sync";

const OPTS = { eloSource: "fide" as const };

function skeleton(): SkeletonGame[] {
    return buildSkeleton(parseFixture(), OPTS);
}

/** The file as it looks straight after the initial import. */
function importedGames(): string[] {
    return splitPgnGames(skeletonToPgn(skeleton()));
}

function find(games: string[], round: string): string {
    const g = games.find((x) => splitGame(x).tags.map.Round === round);
    if (!g) throw new Error(`no game ${round}`);
    return g;
}

function withMoves(game: string, moves: string): string {
    const { tags } = splitGame(game);
    const lines = tags.order.map((t) => `[${t} "${tags.map[t]}"]`).join("\n");
    return `${lines}\n\n${moves}`;
}

function setTag(game: string, tag: string, value: string): string {
    const { tags, movetext } = splitGame(game);
    if (!tags.order.includes(tag)) tags.order.push(tag);
    tags.map[tag] = value;
    const lines = tags.order.map((t) => `[${t} "${tags.map[t]}"]`).join("\n");
    return `${lines}\n\n${movetext}`;
}

describe("hasMoves", () => {
    it("does not count a bare result terminator as moves", () => {
        expect(hasMoves("*")).toBe(false);
        expect(hasMoves("1-0")).toBe(false);
        expect(hasMoves("1/2-1/2")).toBe(false);
        expect(hasMoves("")).toBe(false);
    });

    it("counts real movetext", () => {
        expect(hasMoves("1. e4 e5 *")).toBe(true);
        expect(hasMoves("1. e4 e5 1-0")).toBe(true);
    });
});

describe("isUninformative", () => {
    it("covers empty, placeholders and scaffold names", () => {
        expect(isUninformative("")).toBe(true);
        expect(isUninformative("?")).toBe(true);
        expect(isUninformative("*")).toBe(true);
        expect(isUninformative("Domácí 3")).toBe(true);
        expect(isUninformative("Hosté 8")).toBe(true);
        expect(isUninformative("Šimák, Roman")).toBe(false);
    });
});

describe("planSync", () => {
    it("finds nothing to do when the XML has not moved", () => {
        const plan = planSync(importedGames(), skeleton());
        expect(plan.counts).toEqual({ unchanged: 192, added: 0, fill: 0, update: 0, conflict: 0 });
        expect(plan.orphans).toEqual([]);
        expect(plan.duplicates).toEqual([]);
    });

    it("adds games for a round the file does not have yet", () => {
        const partial = importedGames().filter(
            (g) => !splitGame(g).tags.map.Round.startsWith("10."),
        );
        const plan = planSync(partial, skeleton());
        expect(plan.counts.added).toBe(48);
        expect(plan.rows.find((r) => r.round === "10.1.1")).toMatchObject({
            kind: "added",
            label: "Domácí 1 – Hosté 1",
        });
    });

    it("fills a placeholder line-up without asking", () => {
        // Pretend round 1 was still undrawn in the file: blank out the players.
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1"
                ? setTag(setTag(setTag(g, "White", "Domácí 1"), "Black", "Hosté 1"), "Result", "*")
                : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.kind).toBe("fill");
        expect(row.changes.map((c) => c.tag).sort()).toEqual(["Black", "Result", "White"]);
    });

    it("updates a real change when the game has no moves", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1" ? setTag(g, "White", "Kdosi, Jiný") : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.kind).toBe("update");
        expect(row.hasMoves).toBe(false);
        expect(row.changes).toEqual([{ tag: "White", from: "Kdosi, Jiný", to: "Šimák, Roman" }]);
    });

    it("raises a conflict when the game already carries moves", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1"
                ? withMoves(setTag(g, "White", "Kdosi, Jiný"), "1. d4 Nf6 1/2-1/2")
                : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.kind).toBe("conflict");
        expect(row.hasMoves).toBe(true);
    });

    it("freezes Elo on a played game, so a new rating list is not a conflict", () => {
        // Round 1 is played. Every later XML export carries a fresher FIDE list;
        // that must not reopen games whose rating is already a matter of record.
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round.startsWith("1.")
                ? setTag(setTag(g, "WhiteElo", "1500"), "BlackElo", "1600")
                : g,
        );
        const rows = planSync(games, skeleton()).rows.filter((r) => r.round.startsWith("1."));
        expect(rows.every((r) => r.kind === "unchanged")).toBe(true);
    });

    it("still moves Elo while the board has not been played", () => {
        // Drawn but not played yet: the rating is a preview, so it may still move.
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1"
                ? setTag(setTag(g, "Result", "*"), "WhiteElo", "1500")
                : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.kind).toBe("update");
        expect(row.changes.map((c) => c.tag).sort()).toEqual(["Result", "WhiteElo"]);
    });

    it("fills Elo on a played game that never had one", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1" ? setTag(g, "WhiteElo", "") : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.kind).toBe("fill");
        expect(row.changes.map((c) => c.tag)).toEqual(["WhiteElo"]);
    });

    it("never proposes replacing a known value with a placeholder", () => {
        // The file knows round 10's line-up; the (older) XML does not.
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "10.1.1"
                ? setTag(setTag(g, "White", "Novák, Jan"), "Result", "1-0")
                : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "10.1.1")!;
        expect(row.kind).toBe("unchanged");
        expect(row.changes).toEqual([]);
    });

    it("keeps Event and Site out of the sync", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1"
                ? setTag(setTag(g, "Event", "KSA SSS 25/26 Sedlcany-Kralupy B"), "Site", "Sedlčany")
                : g,
        );
        expect(planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!.kind).toBe(
            "unchanged",
        );
    });

    it("withdraws a forfeit flag once the XML stops claiming one", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1" ? setTag(g, "Termination", "forfeit") : g,
        );
        const row = planSync(games, skeleton()).rows.find((r) => r.round === "1.1.1")!;
        expect(row.changes).toEqual([{ tag: "Termination", from: "forfeit", to: "" }]);
    });

    it("does not withdraw a flag on a round that regressed to undrawn", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "10.1.1" ? setTag(g, "Termination", "forfeit") : g,
        );
        expect(planSync(games, skeleton()).rows.find((r) => r.round === "10.1.1")!.kind).toBe(
            "unchanged",
        );
    });

    it("reports games the XML no longer describes instead of dropping them", () => {
        const stray = '[Event "Přátelák"]\n[Round "?"]\n[White "A, A"]\n[Black "B, B"]\n\n1. e4 *';
        const plan = planSync([...importedGames(), stray], skeleton());
        expect(plan.orphans).toEqual([{ index: 192, round: "?", label: "A, A – B, B" }]);
    });

    it("reports a duplicated Round tag", () => {
        const games = importedGames();
        const plan = planSync([...games, games[0]], skeleton());
        expect(plan.duplicates).toEqual(["1.1.1"]);
        expect(plan.orphans).toHaveLength(1);
    });
});

describe("applySync", () => {
    it("is a no-op when there is nothing to do", () => {
        const games = importedGames();
        expect(applySync(games, skeleton(), planSync(games, skeleton()))).toEqual(games);
    });

    it("applies fills and updates, and leaves conflicts alone", () => {
        const games = importedGames().map((g) => {
            const round = splitGame(g).tags.map.Round;
            if (round === "1.1.1") return setTag(g, "White", "Kdosi, Jiný"); // update
            if (round === "1.1.3") return withMoves(setTag(g, "White", "Kdosi, Jiný"), "1. e4 *");
            return g;
        });
        const plan = planSync(games, skeleton());
        const out = applySync(games, skeleton(), plan);
        expect(splitGame(find(out, "1.1.1")).tags.map.White).toBe("Šimák, Roman");
        expect(splitGame(find(out, "1.1.3")).tags.map.White).toBe("Kdosi, Jiný");
    });

    it("applies a conflict the leader accepted, keeping the moves", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1"
                ? withMoves(setTag(g, "White", "Kdosi, Jiný"), "1. d4 Nf6 1/2-1/2")
                : g,
        );
        const plan = planSync(games, skeleton());
        const out = applySync(games, skeleton(), plan, { acceptedConflicts: ["1.1.1"] });
        const merged = splitGame(find(out, "1.1.1"));
        expect(merged.tags.map.White).toBe("Šimák, Roman");
        expect(merged.movetext).toBe("1. d4 Nf6 1/2-1/2");
    });

    it("keeps the movetext terminator in step with a changed Result", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.2"
                ? withMoves(setTag(g, "Result", "*"), "1. c4 c6 *")
                : g,
        );
        const plan = planSync(games, skeleton());
        const out = applySync(games, skeleton(), plan, { acceptedConflicts: ["1.1.2"] });
        const merged = splitGame(find(out, "1.1.2"));
        expect(merged.tags.map.Result).toBe("1-0");
        expect(merged.movetext).toBe("1. c4 c6 1-0");
    });

    it("removes a withdrawn flag rather than emitting it empty", () => {
        const games = importedGames().map((g) =>
            splitGame(g).tags.map.Round === "1.1.1" ? setTag(g, "Termination", "forfeit") : g,
        );
        const plan = planSync(games, skeleton());
        const out = applySync(games, skeleton(), plan);
        expect(find(out, "1.1.1")).not.toContain("Termination");
    });

    it("inserts added games in (round, match, board) order", () => {
        const partial = importedGames().filter(
            (g) => !splitGame(g).tags.map.Round.startsWith("10."),
        );
        const out = applySync(partial, skeleton(), planSync(partial, skeleton()));
        expect(out).toHaveLength(192);
        expect(out.map((g) => splitGame(g).tags.map.Round)).toEqual(
            skeleton().map((g) => formatRoundTag(g.key)),
        );
    });

    it("appends orphans at the end and never deletes them", () => {
        const stray = '[Event "Přátelák"]\n[Round "?"]\n[White "A, A"]\n[Black "B, B"]\n\n1. e4 *';
        const games = [stray, ...importedGames()];
        const out = applySync(games, skeleton(), planSync(games, skeleton()));
        expect(out).toHaveLength(193);
        expect(out.at(-1)).toBe(stray);
    });
});

describe("gamesToFile", () => {
    it("round-trips through splitPgnGames", () => {
        const games = importedGames();
        expect(splitPgnGames(gamesToFile(games))).toEqual(games);
    });
});

import { describe, expect, it } from "vitest";
import { getTag, splitGame } from "@/utils/pgn/tags";
import {
    applyMatchLabels,
    decomposeEvent,
    type MatchLabels,
    matchEvent,
    readMatchTeams,
    resolveMatchLabels,
    toStoredMatchLabels,
} from "./matchLabels";

const HOME = "ŠK KDJS Sedlčany A";
const AWAY = "Klokani z Kralup";
const EVENT = "KSA SSS 25/26 Sedlcany A-Kralupy B";

/** What the ŠSČR import writes: eight boards, one Event, colours alternating. */
function importedMatch(event = EVENT, boards = 8): string[] {
    const games: string[] = [];
    for (let board = 1; board <= boards; board++) {
        const homeIsWhite = board % 2 === 1;
        games.push(
            [
                `[Event "${event}"]`,
                '[Site "chess.cz"]',
                '[Date "2025.10.12"]',
                `[Round "1.${board}"]`,
                `[White "Bílý ${board}"]`,
                `[Black "Černý ${board}"]`,
                '[Result "*"]',
                `[Board "${board}"]`,
                `[WhiteTeam "${homeIsWhite ? HOME : AWAY}"]`,
                `[BlackTeam "${homeIsWhite ? AWAY : HOME}"]`,
                "",
                "*",
            ].join("\n"),
        );
    }
    return games;
}

const tagOf = (game: string, tag: string) => getTag(splitGame(game).tags, tag);

describe("readMatchTeams", () => {
    it("reads home and away off the board parity", () => {
        expect(readMatchTeams(importedMatch())).toEqual({ home: HOME, away: AWAY });
    });

    it("works on a single game, where white is the home side", () => {
        expect(readMatchTeams(importedMatch().slice(0, 1))).toEqual({ home: HOME, away: AWAY });
    });

    it("survives games with no Board tag by falling back to Round", () => {
        const games = importedMatch().map((g) => g.replace(/\[Board "\d+"\]\n/, ""));
        expect(readMatchTeams(games)).toEqual({ home: HOME, away: AWAY });
    });

    it("is null for a file that is not a match", () => {
        expect(readMatchTeams(['[Event "Kasparov - Karpov"]\n\n*'])).toBeNull();
    });
});

describe("decomposeEvent", () => {
    const teams = { home: HOME, away: AWAY };

    it("picks the split the team names support", () => {
        // "KSA SSS 25/26 Sedlcany A-Kralupy B" also reads as prefix "KSA SSS" +
        // home "25/26 Sedlcany A", and as prefix "KSA SSS 25/26 Sedlcany" + home "A".
        expect(decomposeEvent(EVENT, null, teams)).toEqual({
            prefix: "KSA SSS 25/26",
            homeLabel: "Sedlcany A",
            awayLabel: "Kralupy B",
        });
    });

    it("recovers a label the club dictionary would never produce", () => {
        // "Klokani z Kralup" shortens to "Klokani", but this file says "Kralupy B" —
        // and the file is what the leader is editing.
        expect(decomposeEvent(EVENT, null, teams)?.awayLabel).toBe("Kralupy B");
    });

    it("takes a hinted label as settled", () => {
        const parts = decomposeEvent("KSA 25/26 Sedlcany-Klokani", null, teams, {
            home: ["Sedlcany"],
            away: ["Klokani"],
        });
        expect(parts).toEqual({
            prefix: "KSA 25/26",
            homeLabel: "Sedlcany",
            awayLabel: "Klokani",
        });
    });

    it("follows a custom pattern", () => {
        expect(
            decomposeEvent(
                "KSA 25/26, 1. kolo: Sedlcany A vs Kralupy B",
                "{zkratka}, {kolo}. kolo: {domaci} vs {hoste}",
                teams,
            ),
        ).toMatchObject({ homeLabel: "Sedlcany A", awayLabel: "Kralupy B" });
    });

    it("gives up on an Event that was never composed from a pattern", () => {
        expect(decomposeEvent("Krajská soutěž SŠS 2025/26 - skupina A", null, teams)).toBeNull();
        expect(decomposeEvent("", null, teams)).toBeNull();
    });
});

describe("resolveMatchLabels", () => {
    it("reads the file's own Event apart when nothing is stored", () => {
        const resolved = resolveMatchLabels(importedMatch(), null)!;
        expect(resolved.prefix).toBe("KSA SSS 25/26");
        expect(resolved.home).toEqual({ name: HOME, label: "Sedlcany A", site: "Sedlcany" });
        expect(resolved.away).toMatchObject({ name: AWAY, label: "Kralupy B" });
        expect(resolved.currentEvent).toBe(EVENT);
        expect(resolved.mixedEvents).toBe(false);
    });

    it("falls back to the club dictionary when the Event says nothing", () => {
        const games = importedMatch("Krajská soutěž SŠS 2025/26 - skupina A");
        const resolved = resolveMatchLabels(games, null)!;
        expect(resolved.prefix).toBe("");
        // The import's own "chess.cz" is not a venue, so the derived one applies.
        expect(resolved.home).toEqual({ name: HOME, label: "Sedlcany A", site: "Sedlcany" });
        expect(resolved.away.label).toBe("Klokani");
    });

    it("lets stored pieces win over both the file and the dictionary", () => {
        const stored: MatchLabels = {
            prefix: "KSA 25/26",
            eventPattern: null,
            teams: [
                { name: HOME, label: "Sedlčany", site: "Sedlčany, KDJS" },
                { name: AWAY, label: "Kralupy B", site: "" },
            ],
        };
        const resolved = resolveMatchLabels(importedMatch(), stored)!;
        expect(resolved.prefix).toBe("KSA 25/26");
        expect(resolved.home).toEqual({ name: HOME, label: "Sedlčany", site: "Sedlčany, KDJS" });
        // A deliberately blanked venue stays blank.
        expect(resolved.away.site).toBe("");
    });

    it("keeps a venue the games already carry", () => {
        const games = importedMatch().map((g) =>
            g.replace('[Site "chess.cz"]', '[Site "Sedlčany"]'),
        );
        expect(resolveMatchLabels(games, null)!.home.site).toBe("Sedlčany");
    });

    it("reports games that disagree about Event", () => {
        const games = importedMatch();
        games[3] = games[3].replace(EVENT, "KSA SSS 24/25 Sedlcany A-Kralupy B");
        expect(resolveMatchLabels(games, null)!.mixedEvents).toBe(true);
    });

    it("is null for a file that is not a match", () => {
        expect(resolveMatchLabels(['[Event "X"]\n\n*'], null)).toBeNull();
    });
});

describe("applyMatchLabels", () => {
    const input = {
        prefix: "KSA SSS 25/26",
        eventPattern: "{zkratka} {domaci}-{hoste}",
        home: { name: HOME, label: "Sedlčany A", site: "Sedlčany" },
        away: { name: AWAY, label: "Kralupy B", site: "Kralupy" },
    };

    it("writes the composed Event and the home venue onto every board", () => {
        const games = applyMatchLabels(importedMatch(), input);
        expect(games).toHaveLength(8);
        for (const game of games) {
            expect(tagOf(game, "Event")).toBe("KSA SSS 25/26 Sedlčany A-Kralupy B");
            expect(tagOf(game, "Site")).toBe("Sedlčany");
        }
    });

    it("touches nothing else — teams, players and results stay as they were", () => {
        const before = importedMatch();
        const after = applyMatchLabels(before, input);
        expect(tagOf(after[1], "WhiteTeam")).toBe(AWAY);
        expect(tagOf(after[1], "White")).toBe("Bílý 2");
        expect(tagOf(after[1], "Round")).toBe("1.2");
        expect(tagOf(after[1], "Result")).toBe("*");
    });

    it("leaves Site alone when no venue is set", () => {
        const games = applyMatchLabels(importedMatch(), {
            ...input,
            home: { ...input.home, site: "" },
        });
        expect(tagOf(games[0], "Site")).toBe("chess.cz");
    });

    it("round-trips through what gets stored", () => {
        const stored = toStoredMatchLabels(input);
        expect(stored.eventPattern).toBeNull(); // the default is stored as "no pattern"
        const resolved = resolveMatchLabels(applyMatchLabels(importedMatch(), input), stored)!;
        expect(matchEvent(resolved)).toBe(matchEvent(input));
        expect(resolved.prefix).toBe(input.prefix);
        expect(resolved.home.label).toBe("Sedlčany A");
    });
});

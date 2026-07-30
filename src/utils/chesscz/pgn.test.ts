import { describe, expect, it } from "vitest";
import { isPlayablePairing, normalizeSchedule } from "./pgn";

describe("normalizeSchedule", () => {
    // Shape chess.cz actually returns from /competitions/:id/schedule: the pairings under
    // roundMatches carry NO roundNr/roundDate of their own — those sit on the parent round.
    const raw = [
        {
            roundNr: 5,
            roundDate: "12.10.2024",
            roundMatches: [
                {
                    homeTeamId: 101,
                    homeTeamName: "ŠK KDJS Sedlčany A",
                    homeTeamScore: 5,
                    awayTeamId: 102,
                    awayTeamName: "Cayman Pharma Neratovice B",
                    awayTeamScore: 3,
                },
                // Bye round (volno): no opponent — must stay filtered out.
                {
                    homeTeamId: 103,
                    homeTeamName: "Dubno A",
                    homeTeamScore: null,
                    awayTeamId: 0,
                    awayTeamName: "",
                    awayTeamScore: null,
                },
            ],
        },
    ];

    it("injects the parent round's roundNr/roundDate into each pairing", () => {
        const [round] = normalizeSchedule(raw);
        expect(round.roundNr).toBe(5);
        expect(round.roundMatches[0].roundNr).toBe(5);
        expect(round.roundMatches[0].roundDate).toBe("12.10.2024");
    });

    it("keeps real matches playable (regression: they were all dropped as NaN roundNr)", () => {
        const [round] = normalizeSchedule(raw);
        const playable = round.roundMatches.filter(isPlayablePairing);
        expect(playable).toHaveLength(1);
        expect(playable[0].homeTeamId).toBe(101);
        expect(playable[0].awayTeamId).toBe(102);
    });

    it("accepts a single round object (chess.cz collapses one-element arrays)", () => {
        const rounds = normalizeSchedule(raw[0]);
        expect(rounds).toHaveLength(1);
        expect(rounds[0].roundMatches.filter(isPlayablePairing)).toHaveLength(1);
    });
});

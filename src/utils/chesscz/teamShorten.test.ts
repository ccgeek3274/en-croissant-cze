import { describe, expect, it } from "vitest";
import clubLabelDict from "./data/club_label_dict.json";
import labelOverrides from "./data/label_overrides.json";
import {
    buildDictIndex,
    buildGazIndex,
    compAbbr,
    type DictRow,
    eventPrefix,
    norm,
    parseTeamName,
    regionAbbr,
    resolveCompetition,
    seasonAbbr,
    type ShortenData,
    stripGeoQualifier,
    type TeamInput,
} from "./teamShorten";

// Build the SAME lean reference set the app uses at runtime (see labels.ts): the mined
// club dictionary + manual overrides, and NO gazetteer tier. So these tests assert the
// behaviour en-croissant actually ships, not pgn-base's fuller gazetteer-backed results.
const dict: DictRow[] = (
    clubLabelDict as Array<{ clubId?: number; clubName: string; label?: string }>
)
    .filter((r) => r.label)
    .map((r) => ({ label: r.label as string, clubName: r.clubName, clubId: r.clubId ?? null }));
const overrides = new Map<string, string>();
for (const r of labelOverrides as Array<{ clubName: string; label: string }>) {
    overrides.set(norm(r.clubName), r.label);
}
const data: ShortenData = { dict: buildDictIndex(dict), gaz: buildGazIndex([]), overrides };

const labelMap = (teams: TeamInput[]) => {
    const m = new Map<number, string>();
    for (const r of resolveCompetition(teams, data)) m.set(r.teamId, r.label);
    return m;
};

describe("norm / parseTeamName", () => {
    it("normalizes diacritics and punctuation", () => {
        expect(norm("Český lev Kolešovice B")).toBe("cesky lev kolesovice b");
        expect(norm("2222 ŠK Polabiny, z.s.")).toBe("2222 sk polabiny z s");
    });
    it("splits a trailing team letter, leaves 1./2. alone", () => {
        expect(parseTeamName("Cayman Pharma Neratovice B")).toEqual({
            base: "Cayman Pharma Neratovice",
            letter: "B",
        });
        expect(parseTeamName("1. Novoborský ŠK")).toEqual({
            base: "1. Novoborský ŠK",
            letter: null,
        });
    });
});

describe("resolveCompetition — KSA ground truth (compId 3318), dict-backed", () => {
    const teams: TeamInput[] = [
        { teamId: 1, teamName: "ŠK KDJS Sedlčany A" },
        { teamId: 2, teamName: "Klokani z Kralup" },
        { teamId: 3, teamName: "Dubno A" },
        { teamId: 4, teamName: "TJ Hostivice A" },
        { teamId: 5, teamName: "Český lev Kolešovice B" },
        { teamId: 6, teamName: "Cayman Pharma Neratovice B" },
        { teamId: 7, teamName: "Cayman Pharma Neratovice C" },
        { teamId: 8, teamName: "Caissa Roztoky A" },
        { teamId: 9, teamName: "ŠK Rakovník A" },
        { teamId: 10, teamName: "JAWA Brodce B" },
        { teamId: 11, teamName: "ŠK Řevnice A" },
        { teamId: 12, teamName: "Sokol Buštěhrad A" },
    ];
    const expected: Record<number, string> = {
        1: "Sedlcany A",
        2: "Klokani",
        3: "Dubno A",
        4: "Hostivice A",
        5: "Kolesovice B",
        6: "Neratovice B",
        7: "Neratovice C",
        8: "Roztoky A",
        9: "Rakovnik A",
        10: "JAWA Brodce B",
        11: "Revnice A",
        12: "Bustehrad A",
    };
    it("matches the validated labels exactly", () => {
        const m = labelMap(teams);
        for (const [id, lab] of Object.entries(expected)) expect(m.get(Number(id))).toBe(lab);
    });
    it("labels are unique within the competition", () => {
        const labels = [...labelMap(teams).values()];
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe("resolveCompetition — collision & same-club disambiguation", () => {
    it("same club, multiple teams differ only by letter", () => {
        const m = labelMap([
            { teamId: 1, teamName: "Cayman Pharma Neratovice A" },
            { teamId: 2, teamName: "Cayman Pharma Neratovice B" },
            { teamId: 3, teamName: "Cayman Pharma Neratovice C" },
        ]);
        expect([m.get(1), m.get(2), m.get(3)]).toEqual([
            "Neratovice A",
            "Neratovice B",
            "Neratovice C",
        ]);
    });
});

describe("stripGeoQualifier", () => {
    it("drops a trailing nad/pod locative span", () => {
        expect(stripGeoQualifier("Usti nad Labem")).toBe("Usti");
        expect(stripGeoQualifier("Bakov nad Jizerou")).toBe("Bakov");
    });
    it("keeps a name that starts with the preposition (municipality part)", () => {
        expect(stripGeoQualifier("Pod Cvilinem")).toBe("Pod Cvilinem");
        expect(stripGeoQualifier("Dvur Kralove")).toBe("Dvur Kralove");
    });
});

describe("competition prefix (pure)", () => {
    it("seasonAbbr / regionAbbr", () => {
        expect(seasonAbbr(2025)).toBe("25/26");
        expect(regionAbbr("SŠS")).toBe("SSS");
        expect(regionAbbr("ŠSČR")).toBe("SSCR");
    });
    it("KSA full prefix", () => {
        expect(eventPrefix("Krajská soutěž 'A'", "SŠS", 2025).prefix).toBe("KSA SSS 25/26");
    });
    it("comp-abbr type rules", () => {
        expect(compAbbr("Krajská soutěž 'A'")[0]).toBe("KSA");
        expect(compAbbr("Krajský přebor")[0]).toBe("KP");
        expect(compAbbr("šachy.cz Extraliga")[0]).toBe("Extraliga");
        expect(compAbbr("1. liga")[0]).toBe("1.liga");
    });
    it("override prefix wins verbatim", () => {
        expect(eventPrefix("anything", "SŠS", 2025, "fA SSCR 25/26").prefix).toBe("fA SSCR 25/26");
    });
});

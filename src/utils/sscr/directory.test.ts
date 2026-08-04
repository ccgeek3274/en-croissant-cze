import { describe, expect, it } from "vitest";
import { competitionXml, parseFixture } from "./__fixtures__";
import {
    defaultSite,
    deriveDirectory,
    labelMapFrom,
    prefillDirectory,
    resolveDirectory,
    siteMapFrom,
} from "./directory";
import { buildManifest, type CompetitionManifest } from "./manifest";

function manifest(): CompetitionManifest {
    return buildManifest(parseFixture(), { fileName: "3005.XML", xml: competitionXml });
}

function byName(m: CompetitionManifest, name: string) {
    const team = m.teams.find((t) => t.name === name);
    if (!team) throw new Error(`no team ${name}`);
    return team;
}

describe("defaultSite", () => {
    it("drops the team letter", () => {
        expect(defaultSite("Sedlcany B")).toBe("Sedlcany");
        expect(defaultSite("JAWA Brodce B")).toBe("JAWA Brodce");
    });

    it("keeps a label that has none", () => {
        expect(defaultSite("Klokani")).toBe("Klokani");
        expect(defaultSite("Neratovice")).toBe("Neratovice");
    });

    it("does not mistake a numbered team for a letter", () => {
        expect(defaultSite("Kralupy 2")).toBe("Kralupy 2");
    });
});

describe("deriveDirectory", () => {
    it("shortens every team of the real competition and gives each a venue", () => {
        const derived = deriveDirectory(manifest().teams);
        const sedlcany = derived.get(byName(manifest(), "ŠK KDJS Sedlčany A").no);
        expect(sedlcany).toEqual({ label: "Sedlcany A", site: "Sedlcany" });
        expect(derived.get(byName(manifest(), "Cayman Pharma Neratovice B").no)).toEqual({
            label: "Neratovice B",
            site: "Neratovice",
        });
        expect([...derived.values()].every((e) => e.label && e.site)).toBe(true);
    });
});

describe("resolveDirectory", () => {
    it("fills a competition that has nothing stored", () => {
        // The pre-directory case: every label and site is still null on disk, and the
        // export has to end up with short labels rather than the full XML names.
        const resolved = resolveDirectory(manifest());
        expect(resolved.every((team) => team.label !== "" && team.site !== "")).toBe(true);
        expect(resolved.every((team) => team.label.length <= team.name.length)).toBe(true);
        expect(resolved.find((team) => team.name === "ŠK KDJS Sedlčany A")).toMatchObject({
            label: "Sedlcany A",
            site: "Sedlcany",
        });
    });

    it("lets the leader's label win, and derives the venue from it", () => {
        const m = manifest();
        byName(m, "Klokani z Kralup").label = "Kralupy B";
        const entry = resolveDirectory(m).find((t) => t.name === "Klokani z Kralup")!;
        expect(entry).toMatchObject({ label: "Kralupy B", site: "Kralupy" });
    });

    it("lets the leader's venue win over the derived one", () => {
        const m = manifest();
        byName(m, "ŠK KDJS Sedlčany A").site = "Sedlčany, KDJS";
        const entry = resolveDirectory(m).find((t) => t.name === "ŠK KDJS Sedlčany A")!;
        expect(entry).toMatchObject({ label: "Sedlcany A", site: "Sedlčany, KDJS" });
    });

    it("honours a venue that was deliberately blanked", () => {
        const m = manifest();
        byName(m, "ŠK KDJS Sedlčany A").site = "";
        expect(resolveDirectory(m).find((t) => t.name === "ŠK KDJS Sedlčany A")!.site).toBe("");
    });

    it("keys the export maps by the full name the games carry", () => {
        const m = manifest();
        expect(labelMapFrom(m).get("ŠK KDJS Sedlčany A")).toBe("Sedlcany A");
        expect(siteMapFrom(m).get("ŠK KDJS Sedlčany A")).toBe("Sedlcany");
    });
});

describe("prefillDirectory", () => {
    it("writes the derived defaults and the Event prefix into the manifest", () => {
        const m = prefillDirectory(manifest());
        expect(byName(m, "ŠK KDJS Sedlčany A")).toMatchObject({
            label: "Sedlcany A",
            site: "Sedlcany",
        });
        expect(m.options.eventPrefix).toContain("25/26");
    });

    it("never undoes a hand edit — including a blanked venue", () => {
        const m = manifest();
        byName(m, "ŠK KDJS Sedlčany A").label = "Sedlčany 1";
        byName(m, "Klokani z Kralup").site = "";
        m.options.eventPrefix = "KSA SSS 25/26";
        prefillDirectory(m);
        expect(byName(m, "ŠK KDJS Sedlčany A")).toMatchObject({
            label: "Sedlčany 1",
            site: "Sedlčany 1",
        });
        expect(byName(m, "Klokani z Kralup").site).toBe("");
        expect(m.options.eventPrefix).toBe("KSA SSS 25/26");
    });
});

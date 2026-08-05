import { describe, expect, it } from "vitest";
import {
    buildEventFromPattern,
    buildFileBaseFromPattern,
    compSlug,
    DEFAULT_EVENT_PATTERN,
    fillPattern,
    sanitizeFileBase,
} from "./namePattern";

const VARS = {
    zkratka: "KSA SSS 25/26",
    domaci: "Sedlčany A",
    hoste: "Řevnice A",
    kolo: 3,
};

describe("sanitizeFileBase", () => {
    it("transliterates diacritics and collapses everything else", () => {
        expect(sanitizeFileBase("Sedlčany B")).toBe("Sedlcany_B");
        // The bug this exists for: a competition name used to become mojibake.
        expect(sanitizeFileBase("Krajská soutěž 'A' – 3. kolo")).toBe("Krajska_soutez_A_3_kolo");
    });

    it("trims edge separators and comes back empty when nothing survives", () => {
        expect(sanitizeFileBase("__ksa--")).toBe("ksa");
        expect(sanitizeFileBase("///")).toBe("");
        expect(sanitizeFileBase(null)).toBe("");
    });
});

describe("compSlug", () => {
    it("takes the first word, lower-cased and ASCII", () => {
        expect(compSlug("KSA SSS 25/26")).toBe("ksa");
        expect(compSlug("Přebor 25/26")).toBe("prebor");
        expect(compSlug("")).toBe("");
    });
});

describe("fillPattern", () => {
    it("substitutes every known placeholder", () => {
        expect(fillPattern("{zkratka}|{soutez}|{kolo}|{domaci}|{hoste}", VARS)).toBe(
            "KSA SSS 25/26|ksa|03|Sedlčany A|Řevnice A",
        );
    });

    it("pads the round to two digits and blanks it when there is none", () => {
        expect(fillPattern("{kolo}", { kolo: 3 })).toBe("03");
        expect(fillPattern("{kolo}", { kolo: 11 })).toBe("11");
        expect(fillPattern("{kolo}", {})).toBe("");
    });

    it("leaves an unknown placeholder verbatim, so a typo shows in the preview", () => {
        expect(fillPattern("{nesmysl}-{kolo}", VARS)).toBe("{nesmysl}-03");
    });
});

describe("buildEventFromPattern", () => {
    it("defaults to the format the bulletin uses", () => {
        expect(buildEventFromPattern(null, VARS)).toBe("KSA SSS 25/26 Sedlčany A-Řevnice A");
        expect(buildEventFromPattern("  ", VARS)).toBe(buildEventFromPattern(null, VARS));
        expect(DEFAULT_EVENT_PATTERN).toBe("{zkratka} {domaci}-{hoste}");
    });

    it("honours a custom pattern, diacritics and all", () => {
        expect(buildEventFromPattern("{zkratka} / {kolo}. kolo / {domaci} vs {hoste}", VARS)).toBe(
            "KSA SSS 25/26 / 03. kolo / Sedlčany A vs Řevnice A",
        );
    });

    it("falls back rather than emitting an empty Event", () => {
        expect(buildEventFromPattern("{domaci}", { ...VARS, domaci: "" })).toBe(
            "KSA SSS 25/26 -Řevnice A",
        );
    });
});

describe("buildFileBaseFromPattern", () => {
    it("defaults to <soutez>_<kolo>", () => {
        expect(buildFileBaseFromPattern(null, VARS)).toBe("ksa_03");
    });

    it("sanitizes a custom pattern's result", () => {
        expect(buildFileBaseFromPattern("KSA-kolo{kolo}_ŠSČR", VARS)).toBe("KSA-kolo03_SSCR");
    });

    it("falls back to the default, then to a constant, rather than to nothing", () => {
        expect(buildFileBaseFromPattern("///", VARS)).toBe("ksa_03");
        expect(buildFileBaseFromPattern("///", {})).toBe("export");
    });
});

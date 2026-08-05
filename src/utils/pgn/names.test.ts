import { describe, expect, it } from "vitest";
import { toPgnName } from "./names";

describe("toPgnName", () => {
    it("splits the plain two-token case", () => {
        expect(toPgnName("Šimák Roman")).toBe("Šimák, Roman");
        expect(toPgnName("Hánl František")).toBe("Hánl, František");
    });

    it("keeps a generational suffix with the surname", () => {
        // Ground truth: Swiss-Manager's own PGN writes "Aulický st., Radim".
        expect(toPgnName("Aulický st. Radim")).toBe("Aulický st., Radim");
        expect(toPgnName("Aulický ml. Radim")).toBe("Aulický ml., Radim");
    });

    it("treats every remaining token as the given name", () => {
        // Swiss-Manager writes "Nguyen, Minh Khang Tomáš".
        expect(toPgnName("Nguyen Minh Khang Tomáš")).toBe("Nguyen, Minh Khang Tomáš");
        expect(toPgnName("Pejša Matěj Jakub")).toBe("Pejša, Matěj Jakub");
    });

    it("normalizes whitespace", () => {
        expect(toPgnName("  Novák   Jan  ")).toBe("Novák, Jan");
    });

    it("leaves board placeholders alone", () => {
        // Digits mean a scaffold name — the export must not write "Domácí, 3".
        expect(toPgnName("Domácí 3")).toBe("Domácí 3");
        expect(toPgnName("Hosté 12")).toBe("Hosté 12");
    });

    it("is idempotent, so import + export can both run it", () => {
        const once = toPgnName("Šimák Roman");
        expect(toPgnName(once)).toBe(once);
        expect(toPgnName("Novák,Jan")).toBe("Novák, Jan");
        expect(toPgnName("Novák ,  Jan")).toBe("Novák, Jan");
    });

    it("passes through what it cannot or must not split", () => {
        expect(toPgnName("Novák, Jan")).toBe("Novák, Jan");
        expect(toPgnName("Novák")).toBe("Novák");
        expect(toPgnName("")).toBe("");
        expect(toPgnName(null)).toBe("");
        expect(toPgnName(undefined)).toBe("");
    });
});

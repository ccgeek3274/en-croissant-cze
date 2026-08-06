import { describe, expect, it } from "vitest";
import type { FileMetadata } from "@/components/files/file";
import { needsSaveConfirmation, type Tab } from "./tabs";

const file: FileMetadata = {
    type: "file",
    name: "KSA_SSS_25_26",
    path: "/games/KSA_SSS_25_26/KSA_SSS_25_26.pgn",
    numGames: 528,
    metadata: { type: "tournament", tags: [] },
    lastModified: 0,
};

function tabOf(type: Tab["type"], origin: Tab["gameOrigin"]): Tab {
    return { name: "t", value: "abcd1234", type, gameOrigin: origin };
}

const fromFile: Tab["gameOrigin"] = { kind: "file", file, gameNumber: 0 };
const dirty = JSON.stringify({ version: 0, state: { dirty: true } });
const clean = JSON.stringify({ version: 0, state: { dirty: false } });

describe("needsSaveConfirmation", () => {
    it("asks before dropping unsaved moves of a file-backed analysis tab", () => {
        expect(needsSaveConfirmation(tabOf("analysis", fromFile), dirty)).toBe(true);
        expect(needsSaveConfirmation(tabOf("play", fromFile), dirty)).toBe(true);
    });

    it("stays quiet when nothing is dirty", () => {
        expect(needsSaveConfirmation(tabOf("analysis", fromFile), clean)).toBe(false);
    });

    it("stays quiet for a tab whose game is not persisted anywhere", () => {
        expect(needsSaveConfirmation(tabOf("analysis", { kind: "none" }), dirty)).toBe(false);
    });

    // The bug: the competition tab holds no move tree, so it has no sessionStorage
    // entry at all — and the missing `state` used to throw, which swallowed the close.
    it("closes the competition tab without a prompt", () => {
        expect(needsSaveConfirmation(tabOf("competition", fromFile), null)).toBe(false);
        expect(needsSaveConfirmation(tabOf("competition", fromFile), dirty)).toBe(false);
    });

    it("survives a missing or unparsable entry", () => {
        expect(needsSaveConfirmation(tabOf("analysis", fromFile), null)).toBe(false);
        expect(needsSaveConfirmation(tabOf("analysis", fromFile), "{}")).toBe(false);
        expect(needsSaveConfirmation(tabOf("analysis", fromFile), "not json")).toBe(false);
        expect(needsSaveConfirmation(undefined, dirty)).toBe(false);
    });
});

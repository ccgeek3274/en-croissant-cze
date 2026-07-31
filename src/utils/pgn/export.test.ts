import { describe, expect, it } from "vitest";
import { FULL_CLEANUP } from "./cleanup";
import { buildExportGame, buildExportPgn, type ExportOptions } from "./export";
import { splitGame } from "./tags";

const GAME = `[Event "Test Cup"]
[Site "Prague"]
[Date "2024.10.12"]
[Round "1.1"]
[White "Kovář, Jiří"]
[Black "Novák, Petr"]
[Result "1-0"]
[WhiteElo "2100"]
[BlackElo "2050"]
[WhiteTeam "Praha"]
[BlackTeam "Brno"]
[ECO "C50"]

1. e4! e5 {a solid reply} 2. Nf3 (2. Bc4 Bc5) 2... Nc6 1-0`;

const keepAll: ExportOptions = { headers: "all", cleanup: null, stripDiacritics: false };

describe("buildExportGame", () => {
    it("keeps everything verbatim by default", () => {
        const out = buildExportGame(GAME, keepAll);
        expect(out).toContain('[WhiteTeam "Praha"]');
        expect(out).toContain("(2. Bc4 Bc5)");
        expect(out).toContain("{a solid reply}");
    });

    it("standard headers keep only the STR subset + Elo/ECO", () => {
        const out = buildExportGame(GAME, { ...keepAll, headers: "standard" });
        expect(out).toContain('[WhiteElo "2100"]');
        expect(out).toContain('[ECO "C50"]');
        expect(out).not.toContain("WhiteTeam");
    });

    it("cleaned movetext leaves no dangling ellipsis", () => {
        const out = buildExportGame(GAME, { ...keepAll, cleanup: FULL_CLEANUP });
        const { movetext } = splitGame(out);
        expect(movetext).toBe("1. e4 e5 2. Nf3 Nc6 1-0");
        expect(movetext).not.toContain("...");
    });

    it("strips diacritics across the whole output when asked", () => {
        const out = buildExportGame(GAME, { ...keepAll, stripDiacritics: true });
        expect(out).toContain('[White "Kovar, Jiri"]');
        expect(out).not.toMatch(/[řížá]/);
    });

    it("syncs the movetext terminator to the Result header after cleaning", () => {
        const drawn = GAME.replace('[Result "1-0"]', '[Result "1/2-1/2"]').replace(/1-0$/, "*");
        const out = buildExportGame(drawn, { ...keepAll, cleanup: FULL_CLEANUP });
        expect(splitGame(out).movetext.endsWith("1/2-1/2")).toBe(true);
    });
});

describe("buildExportPgn", () => {
    it("joins multiple games and ends with a newline", () => {
        const out = buildExportPgn([GAME, GAME], keepAll);
        expect(out.split("[Event ").length - 1).toBe(2);
        expect(out.endsWith("\n")).toBe(true);
    });
});

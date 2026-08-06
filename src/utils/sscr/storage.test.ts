// Where a competition's files land: one directory per competition, everything in it.
// Only the Tauri fs boundary is mocked — a path→content map plus a set of
// directories, with `rename` moving a whole subtree the way the real one does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { competitionXml, parseFixture } from "./__fixtures__";

const { files, dirs } = vi.hoisted(() => ({
    files: new Map<string, string>(),
    dirs: new Set<string>(),
}));

vi.mock("@tauri-apps/api/path", () => ({
    resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
    mkdir: vi.fn(async (p: string) => {
        dirs.add(p);
    }),
    readTextFile: vi.fn(async (p: string) => {
        const text = files.get(p);
        if (text === undefined) throw new Error(`no such file: ${p}`);
        return text;
    }),
    writeTextFile: vi.fn(async (p: string, text: string) => {
        files.set(p, text);
    }),
    remove: vi.fn(async (p: string) => {
        if ([...files.keys()].some((f) => f.startsWith(`${p}/`))) {
            throw new Error(`directory not empty: ${p}`);
        }
        dirs.delete(p);
    }),
    rename: vi.fn(async (from: string, to: string) => {
        if (files.has(from)) {
            files.set(to, files.get(from)!);
            files.delete(from);
            return;
        }
        if (!dirs.has(from)) throw new Error(`no such path: ${from}`);
        for (const dir of [...dirs]) {
            if (dir === from || dir.startsWith(`${from}/`)) {
                dirs.delete(dir);
                dirs.add(to + dir.slice(from.length));
            }
        }
        for (const [path, text] of [...files]) {
            if (path.startsWith(`${from}/`)) {
                files.delete(path);
                files.set(to + path.slice(from.length), text);
            }
        }
    }),
}));

// Imported after the mocks are registered.
import { buildManifest, serializeManifest } from "./manifest";
import {
    createCompetition,
    isCompetitionFile,
    loadCompetition,
    renameCompetitionSidecars,
} from "./storage";

const DIR = "/docs/KSA";
const PGN_PATH = `${DIR}/KSA.pgn`;
const STAMP = new Date().toISOString().slice(0, 10);

beforeEach(() => {
    files.clear();
    dirs.clear();
});

function create() {
    return createCompetition({
        dir: "/docs",
        name: "KSA",
        sourceFileName: "3005.XML",
        xml: competitionXml,
        competition: parseFixture(),
        eloSource: "fide",
    });
}

function manifestJson() {
    return serializeManifest(buildManifest(parseFixture(), { fileName: "3005.XML", xml: "<x/>" }));
}

describe("createCompetition", () => {
    it("puts the whole competition in a directory of its own", async () => {
        const { pgnPath } = await create();

        expect(pgnPath).toBe(PGN_PATH);
        expect(dirs.has(DIR)).toBe(true);
        expect([...files.keys()].sort()).toEqual(
            [
                PGN_PATH,
                `${DIR}/KSA.info`,
                `${DIR}/KSA.competition.json`,
                `${DIR}/KSA.xml-archiv/${STAMP}-3005.xml`,
            ].sort(),
        );
    });

    it("writes a manifest the loader finds again", async () => {
        await create();

        expect(await isCompetitionFile(PGN_PATH)).toBe(true);
        const loaded = await loadCompetition(PGN_PATH);
        expect(loaded?.manifest.source.fileName).toBe("3005.XML");
        expect(loaded?.games.length).toBe(192);
    });

    it("refuses to write over a directory that is already there", async () => {
        dirs.add(DIR);
        await expect(create()).rejects.toThrow("File already exists");
    });
});

describe("a competition outside a directory of its own", () => {
    // Everything is keyed off the .pgn's path, so competitions imported before the
    // directory existed keep working exactly where they are.
    it("is loaded from beside its .pgn", async () => {
        files.set("/docs/KSA.pgn", "");
        files.set("/docs/KSA.competition.json", manifestJson());

        expect(await isCompetitionFile("/docs/KSA.pgn")).toBe(true);
        expect((await loadCompetition("/docs/KSA.pgn"))?.manifest.competition.teamCount).toBe(12);
    });
});

describe("a competition written into a `.competition/` working directory", () => {
    // The layout of one build in between: it is undone on first contact.
    function seed() {
        files.set(PGN_PATH, "");
        files.set(`${DIR}/KSA.competition/competition.json`, manifestJson());
        dirs.add(`${DIR}/KSA.competition`);
        dirs.add(`${DIR}/KSA.competition/xml`);
        files.set(`${DIR}/KSA.competition/xml/2026-03-15-3005.xml`, competitionXml);
    }

    it("is still recognised as a competition", async () => {
        seed();
        expect(await isCompetitionFile(PGN_PATH)).toBe(true);
    });

    it("moves back beside its .pgn, and the empty directory goes", async () => {
        seed();

        const loaded = await loadCompetition(PGN_PATH);

        expect(loaded?.manifest.source.fileName).toBe("3005.XML");
        expect(files.has(`${DIR}/KSA.competition.json`)).toBe(true);
        expect(files.get(`${DIR}/KSA.xml-archiv/2026-03-15-3005.xml`)).toBe(competitionXml);
        expect(dirs.has(`${DIR}/KSA.competition`)).toBe(false);
    });
});

describe("renameCompetitionSidecars", () => {
    it("takes the manifest and the XML archive along", async () => {
        await create();

        await renameCompetitionSidecars(PGN_PATH, `${DIR}/KSA 25-26.pgn`);

        expect(files.has(`${DIR}/KSA 25-26.competition.json`)).toBe(true);
        expect(files.has(`${DIR}/KSA.competition.json`)).toBe(false);
        expect(files.has(`${DIR}/KSA 25-26.xml-archiv/${STAMP}-3005.xml`)).toBe(true);
    });

    it("does nothing for a database that is not a competition", async () => {
        files.set("/docs/hry.pgn", "");
        await expect(
            renameCompetitionSidecars("/docs/hry.pgn", "/docs/partie.pgn"),
        ).resolves.toBeUndefined();
    });
});

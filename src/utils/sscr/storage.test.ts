// Where a competition's files land, and how one written before the working
// directory existed is moved into it. Only the Tauri fs boundary is mocked — a
// path→content map plus a set of directories, with `rename` moving a whole subtree
// the way the real one does.

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
import { createCompetition, isCompetitionFile, loadCompetition } from "./storage";

const PGN_PATH = "/docs/KSA.pgn";
const WORK_DIR = "/docs/KSA.competition";

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

/** A competition as it was written before the working directory existed. */
function seedLegacyCompetition() {
    files.set(PGN_PATH, "");
    files.set(
        "/docs/KSA.competition.json",
        serializeManifest(buildManifest(parseFixture(), { fileName: "3005.XML", xml: "<old/>" })),
    );
    dirs.add("/docs/KSA.xml-archiv");
    files.set("/docs/KSA.xml-archiv/2026-03-15-3005.xml", competitionXml);
}

describe("createCompetition", () => {
    it("keeps everything but the .pgn and the .info in the working directory", async () => {
        const { pgnPath } = await create();
        const stamp = new Date().toISOString().slice(0, 10);

        expect(pgnPath).toBe(PGN_PATH);
        expect([...files.keys()].sort()).toEqual(
            [
                PGN_PATH,
                "/docs/KSA.info",
                `${WORK_DIR}/competition.json`,
                `${WORK_DIR}/xml/${stamp}-3005.xml`,
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
});

describe("a competition written before the working directory existed", () => {
    it("is still recognised as one", async () => {
        seedLegacyCompetition();
        expect(await isCompetitionFile(PGN_PATH)).toBe(true);
    });

    it("moves into the working directory when it is opened, and still loads", async () => {
        seedLegacyCompetition();

        const loaded = await loadCompetition(PGN_PATH);

        expect(loaded?.manifest.source.fileName).toBe("3005.XML");
        expect(files.has("/docs/KSA.competition.json")).toBe(false);
        expect(files.has(`${WORK_DIR}/competition.json`)).toBe(true);
        expect(dirs.has("/docs/KSA.xml-archiv")).toBe(false);
        expect(files.get(`${WORK_DIR}/xml/2026-03-15-3005.xml`)).toBe(competitionXml);
    });

    it("is left alone once the working directory already holds a manifest", async () => {
        seedLegacyCompetition();
        files.set(`${WORK_DIR}/competition.json`, files.get("/docs/KSA.competition.json")!);

        await loadCompetition(PGN_PATH);

        // The newer manifest wins and the stale one is neither read nor destroyed.
        expect(files.has("/docs/KSA.competition.json")).toBe(true);
    });
});

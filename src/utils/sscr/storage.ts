// On-disk shape of a competition, and the two operations that write it: the
// initial import from XML and a re-sync against a newer export.
//
//   KSA_2025_26/                    one directory per competition, nothing outside it
//     KSA_2025_26.pgn               the whole season, full format, single source of truth
//     KSA_2025_26.info              en-croissant's own sidecar ({ type: "tournament" })
//     KSA_2025_26.competition.json  the manifest — draw, team labels, venues, source stamp
//     KSA_2025_26.xml-archiv/       every imported XML, kept for audit
//
// Everything is keyed off the .pgn's own path, so a competition works wherever it
// sits: the directory is what the import creates, not something the code depends on.
// That keeps competitions imported before the directory existed working untouched,
// and lets the leader move or rename the folder in the file manager.
//
// One file rather than one per match: the tree (competition → round → match →
// game) is a filter over the `Round` tag, so header work, Kontrola and export all
// run over one in-memory list and one atomic write. A full season with moves is
// ~400 kB.

import { resolve } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { splitPgnGames } from "@/utils/pgn/tags";
import { sanitizeFilename } from "@/utils/filename";
import { prefillDirectory } from "./directory";
import { type MatchLabels, matchLabelsSchema } from "./matchLabels";
import { type Competition, type ParseIssue, parseCompetitionXml } from "./competitionXml";
import {
    buildManifest,
    type CompetitionManifest,
    contentHash,
    manifestPathFor,
    mergeManifest,
    parseManifest,
    serializeManifest,
    siteByTeamNo,
} from "./manifest";
import { buildSkeleton, type SkeletonGame, skeletonToPgn } from "./skeleton";
import { applySync, gamesToFile, planSync, type SyncPlan } from "./sync";

/** en-croissant's own sidecar, which it looks for beside the .pgn. */
function infoPathFor(pgnPath: string): string {
    return pgnPath.replace(/\.pgn$/i, "") + ".info";
}

/** Directory holding the imported XML snapshots for one competition. */
export function archiveDirFor(pgnPath: string): string {
    return pgnPath.replace(/\.pgn$/i, "") + ".xml-archiv";
}

export type LoadedCompetition = {
    pgnPath: string;
    manifest: CompetitionManifest;
    games: string[];
};

async function ensureDir(path: string): Promise<void> {
    if (!(await exists(path))) await mkdir(path, { recursive: true });
}

/** Path of the manifest, or null when this .pgn is not a competition. */
async function findManifest(pgnPath: string): Promise<string | null> {
    const path = manifestPathFor(pgnPath);
    if (await exists(path)) return path;
    return (await migrateWorkDirLayout(pgnPath)) ? path : null;
}

/** One build kept the manifest and the XML archive in a `<base>.competition/`
 *  directory of their own, before the whole competition moved into a directory
 *  instead. Undo that when we meet it: bring both back beside the .pgn, where every
 *  path helper looks for them, and drop the directory once it is empty. Returns
 *  whether a manifest arrived. */
async function migrateWorkDirLayout(pgnPath: string): Promise<boolean> {
    const workDir = pgnPath.replace(/\.pgn$/i, "") + ".competition";
    const separator = workDir.includes("\\") ? "\\" : "/";
    const staleManifest = `${workDir}${separator}competition.json`;
    const staleArchive = `${workDir}${separator}xml`;
    if (!(await exists(staleManifest))) return false;

    if ((await exists(staleArchive)) && !(await exists(archiveDirFor(pgnPath)))) {
        await rename(staleArchive, archiveDirFor(pgnPath));
    }
    await rename(staleManifest, manifestPathFor(pgnPath));
    // Empty by now unless the leader put something of their own in it — in which
    // case `remove` refuses and the directory simply stays.
    await remove(workDir).catch(() => {});
    return true;
}

/** True when this .pgn is a competition (i.e. it has a manifest beside it). */
export async function isCompetitionFile(pgnPath: string): Promise<boolean> {
    return (await findManifest(pgnPath)) !== null;
}

/** Load a competition. Returns null when the file has no (readable) manifest — the
 *  caller then treats it as an ordinary database. */
export async function loadCompetition(pgnPath: string): Promise<LoadedCompetition | null> {
    const manifestPath = await findManifest(pgnPath);
    if (!manifestPath) return null;
    const manifest = parseManifest(await readTextFile(manifestPath));
    if (!manifest) return null;
    return { pgnPath, manifest, games: splitPgnGames(await readTextFile(pgnPath)) };
}

/** Write both halves back. The .pgn is written first: a manifest that is one
 *  re-sync ahead of the games would misreport the draw, the other way round only
 *  costs a re-run. */
export async function saveCompetition(
    pgnPath: string,
    manifest: CompetitionManifest,
    games: string[],
): Promise<void> {
    await writeTextFile(pgnPath, gamesToFile(games));
    await writeTextFile(manifestPathFor(pgnPath), serializeManifest(manifest));
}

/** Everything that belongs to a competition and is named after its .pgn, so a rename
 *  in the file list takes the whole competition with it instead of orphaning the
 *  manifest. The .pgn and the .info are already handled by the caller — it renames
 *  those for every database, competition or not. */
export async function renameCompetitionSidecars(
    oldPgnPath: string,
    newPgnPath: string,
): Promise<void> {
    for (const pathFor of [manifestPathFor, archiveDirFor]) {
        const from = pathFor(oldPgnPath);
        if ((await exists(from)) && !(await exists(pathFor(newPgnPath)))) {
            await rename(from, pathFor(newPgnPath));
        }
    }
}

// ── zkratky zápasu ──────────────────────────────────────────────────────────
// One imported match is a plain .pgn with no manifest (see `matchLabels.ts`), so
// its abbreviation, labels and venues ride in the `.info` sidecar every database
// already has. Unknown keys survive a round trip through this pair, so en-croissant
// (and a future upstream field) keeps whatever else it put there.

type InfoSidecar = { type: string; tags: string[]; match?: MatchLabels } & Record<string, unknown>;

async function readInfo(pgnPath: string): Promise<InfoSidecar> {
    const path = infoPathFor(pgnPath);
    if (await exists(path)) {
        try {
            const parsed = JSON.parse(await readTextFile(path));
            if (parsed && typeof parsed === "object") return parsed as InfoSidecar;
        } catch {
            // A corrupt sidecar is not worth failing over — it is metadata, and the
            // caller is about to write a valid one.
        }
    }
    return { type: "other", tags: [] };
}

/** The stored label pieces of a match .pgn, or null when it has none yet. */
export async function loadMatchLabels(pgnPath: string): Promise<MatchLabels | null> {
    const parsed = matchLabelsSchema.safeParse((await readInfo(pgnPath)).match);
    return parsed.success ? parsed.data : null;
}

export async function saveMatchLabels(pgnPath: string, labels: MatchLabels): Promise<void> {
    const info = await readInfo(pgnPath);
    await writeTextFile(infoPathFor(pgnPath), JSON.stringify({ ...info, match: labels }));
}

/** Keep a copy of every XML we imported, named by the round it brought in. */
async function archiveXml(pgnPath: string, sourceName: string, xml: string): Promise<void> {
    const dir = archiveDirFor(pgnPath);
    await ensureDir(dir);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = sanitizeFilename(sourceName.replace(/\.xml$/i, "")) || "soutez";
    await writeTextFile(await resolve(dir, `${stamp}-${base}.xml`), xml);
}

// ── the two write operations ────────────────────────────────────────────────

export type ImportPreview = {
    competition: Competition;
    issues: ParseIssue[];
    skeleton: SkeletonGame[];
};

/** Parse an XML and build everything the import dialog needs to show, without
 *  touching the disk. Returns the issues alone when the file is unusable. */
export function previewImport(
    xml: string,
    opts: { eloSource: "fide" | "cze" },
): ImportPreview | { issues: ParseIssue[] } {
    const { competition, issues } = parseCompetitionXml(xml);
    if (!competition) return { issues };
    return { competition, issues, skeleton: buildSkeleton(competition, opts) };
}

export type CreateCompetitionInput = {
    /** Directory the competition's own directory is created in. */
    dir: string;
    /** Name of both the directory and the files in it; sanitized before use. */
    name: string;
    /** Base name of the XML the leader picked, for the source stamp and the archive. */
    sourceFileName: string;
    xml: string;
    competition: Competition;
    eloSource: "fide" | "cze";
    compId?: number | null;
};

export type CreateCompetitionResult = {
    pgnPath: string;
    manifest: CompetitionManifest;
    gameCount: number;
};

/** Create a new competition — .pgn + .info + manifest + the archived XML — in a
 *  directory of its own, so the leader's folder gains one entry per season instead
 *  of four. */
export async function createCompetition(
    input: CreateCompetitionInput,
): Promise<CreateCompetitionResult> {
    const safeName = sanitizeFilename(input.name);
    if (!safeName) throw new Error("Invalid file name");

    const competitionDir = await resolve(input.dir, safeName);
    if (await exists(competitionDir)) throw new Error("File already exists");
    const pgnPath = await resolve(competitionDir, `${safeName}.pgn`);
    await mkdir(competitionDir, { recursive: true });

    const manifest = prefillDirectory(
        buildManifest(
            input.competition,
            { fileName: input.sourceFileName, xml: input.xml },
            { eloSource: input.eloSource, compId: input.compId ?? null },
        ),
    );
    const skeleton = buildSkeleton(input.competition, {
        eloSource: input.eloSource,
        siteByTeamNo: siteByTeamNo(manifest),
    });
    const games = splitPgnGames(skeletonToPgn(skeleton));

    await saveCompetition(pgnPath, manifest, games);
    await writeTextFile(infoPathFor(pgnPath), JSON.stringify({ type: "tournament", tags: [] }));
    await archiveXml(pgnPath, input.sourceFileName, input.xml);

    return { pgnPath, manifest, gameCount: games.length };
}

export type ResyncPreview = {
    competition: Competition;
    issues: ParseIssue[];
    skeleton: SkeletonGame[];
    plan: SyncPlan;
    /** The new XML is byte-for-byte the file we last imported. */
    unchangedSource: boolean;
};

/** Build the re-sync report for a loaded competition and a newly picked XML. */
export function previewResync(
    loaded: LoadedCompetition,
    xml: string,
): ResyncPreview | { issues: ParseIssue[] } {
    const { competition, issues } = parseCompetitionXml(xml);
    if (!competition) return { issues };
    const skeleton = buildSkeleton(competition, {
        eloSource: loaded.manifest.options.eloSource,
        siteByTeamNo: siteByTeamNo(loaded.manifest),
    });
    return {
        competition,
        issues,
        skeleton,
        plan: planSync(loaded.games, skeleton),
        unchangedSource: contentHash(xml) === loaded.manifest.source.hash,
    };
}

export type ApplyResyncInput = {
    loaded: LoadedCompetition;
    preview: ResyncPreview;
    sourceFileName: string;
    xml: string;
    /** Round tags of conflicts the leader chose to overwrite. */
    acceptedConflicts: string[];
};

/** Apply a re-sync: rewrite the games, refresh the manifest (keeping the leader's
 *  labels and options), and archive the XML. */
export async function applyResync(input: ApplyResyncInput): Promise<{ games: string[] }> {
    const { loaded, preview } = input;
    const games = applySync(loaded.games, preview.skeleton, preview.plan, {
        acceptedConflicts: input.acceptedConflicts,
    });
    // A team that only appears in the newer XML still gets a label and a venue.
    const manifest = prefillDirectory(
        mergeManifest(
            loaded.manifest,
            buildManifest(preview.competition, { fileName: input.sourceFileName, xml: input.xml }),
        ),
    );
    await saveCompetition(loaded.pgnPath, manifest, games);
    await archiveXml(loaded.pgnPath, input.sourceFileName, input.xml);
    return { games };
}

// On-disk shape of a competition, and the two operations that write it: the
// initial import from XML and a re-sync against a newer export.
//
//   KSA_2025_26.pgn                 the whole season, full format, single source of truth
//   KSA_2025_26.info                en-croissant's own sidecar ({ type: "tournament" })
//   KSA_2025_26.competition/        the working directory — the mode's own bookkeeping
//     competition.json              the manifest — draw, team labels, venues, source stamp
//     xml/                          every imported XML, kept for audit
//
// The leader's folder therefore shows the season and nothing else: the manifest and
// the XML archive are in one directory the file list hides, and only the `.info`
// stays beside the .pgn, because that is where en-croissant itself looks for it.
// Competitions created before the working directory existed are moved into it the
// first time they are opened — see `migrateLegacyLayout`.
//
// One file rather than one per match: the tree (competition → round → match →
// game) is a filter over the `Round` tag, so header work, Kontrola and export all
// run over one in-memory list and one atomic write. A full season with moves is
// ~400 kB.

import { resolve } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { splitPgnGames } from "@/utils/pgn/tags";
import { sanitizeFilename } from "@/utils/filename";
import { prefillDirectory } from "./directory";
import { type Competition, type ParseIssue, parseCompetitionXml } from "./competitionXml";
import {
    buildManifest,
    type CompetitionManifest,
    contentHash,
    legacyManifestPathFor,
    manifestPathFor,
    mergeManifest,
    parseManifest,
    serializeManifest,
    siteByTeamNo,
    workDirFor,
    workFilePathFor,
} from "./manifest";
import { buildSkeleton, type SkeletonGame, skeletonToPgn } from "./skeleton";
import { applySync, gamesToFile, planSync, type SyncPlan } from "./sync";

/** Directory holding the imported XML snapshots for one competition. */
export function archiveDirFor(pgnPath: string): string {
    return workFilePathFor(pgnPath, "xml");
}

/** Where those snapshots lived before the working directory existed. */
function legacyArchiveDirFor(pgnPath: string): string {
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

/** The manifest of this .pgn, wherever it currently is: in the working directory, or
 *  — for a competition that has not been opened since the directory existed — beside
 *  the .pgn. Null when this is not a competition at all. */
async function findManifest(pgnPath: string): Promise<string | null> {
    const current = manifestPathFor(pgnPath);
    if (await exists(current)) return current;
    const legacy = legacyManifestPathFor(pgnPath);
    return (await exists(legacy)) ? legacy : null;
}

/** Move a competition written before the working directory existed into it. Both
 *  halves are *renamed*, and only into a place that is still free, so nothing the
 *  leader has is overwritten or deleted; a competition that is already migrated pays
 *  two `exists` calls and stops. */
async function migrateLegacyLayout(pgnPath: string): Promise<void> {
    const legacyManifest = legacyManifestPathFor(pgnPath);
    const legacyArchive = legacyArchiveDirFor(pgnPath);
    const [hasManifest, hasArchive] = await Promise.all([
        exists(legacyManifest),
        exists(legacyArchive),
    ]);
    if (!hasManifest && !hasArchive) return;

    await ensureDir(workDirFor(pgnPath));
    if (hasArchive && !(await exists(archiveDirFor(pgnPath)))) {
        await rename(legacyArchive, archiveDirFor(pgnPath));
    }
    if (hasManifest && !(await exists(manifestPathFor(pgnPath)))) {
        await rename(legacyManifest, manifestPathFor(pgnPath));
    }
}

/** True when this .pgn is a competition (i.e. it has a manifest). */
export async function isCompetitionFile(pgnPath: string): Promise<boolean> {
    return (await findManifest(pgnPath)) !== null;
}

/** Load a competition. Returns null when the file has no (readable) manifest — the
 *  caller then treats it as an ordinary database. Opening is also where an older
 *  competition moves into its working directory. */
export async function loadCompetition(pgnPath: string): Promise<LoadedCompetition | null> {
    await migrateLegacyLayout(pgnPath);
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
    await ensureDir(workDirFor(pgnPath));
    await writeTextFile(manifestPathFor(pgnPath), serializeManifest(manifest));
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
    /** Directory to create the competition in. */
    dir: string;
    /** File name without extension; sanitized before use. */
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

/** Create a new competition: .pgn + .info + manifest + the archived XML. */
export async function createCompetition(
    input: CreateCompetitionInput,
): Promise<CreateCompetitionResult> {
    const safeName = sanitizeFilename(input.name);
    if (!safeName) throw new Error("Invalid file name");

    const pgnPath = await resolve(input.dir, `${safeName}.pgn`);
    if (await exists(pgnPath)) throw new Error("File already exists");

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
    await writeTextFile(
        pgnPath.replace(/\.pgn$/i, ".info"),
        JSON.stringify({ type: "tournament", tags: [] }),
    );
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

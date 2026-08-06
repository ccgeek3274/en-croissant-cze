// The competition manifest — the JSON file in the competition's working directory
// that holds what is *not* per-game and could not be reconstructed from the PGN:
// where the XML came from, the draw, and the team-label directory used to compose
// ŠSČR-style Event tags on export.
//
// Pure: schema, derivation and path helpers only. Reading and writing the file is
// the storage layer's job, so this module stays unit-testable.

import { z } from "zod";
import type { Competition } from "./competitionXml";

export const MANIFEST_VERSION = 1;

/** Working directory of a competition — everything the mode keeps for itself lives
 *  in it, so the leader's folder holds the season and nothing else:
 *  `KSA_2025_26.pgn` → `KSA_2025_26.competition/`. */
export const WORK_DIR_SUFFIX = ".competition";

/** Where the manifest sat before the working directory existed. Read-only: the
 *  storage layer moves such a competition over the first time it opens it. */
export const LEGACY_MANIFEST_SUFFIX = ".competition.json";

export const manifestTeamSchema = z.object({
    no: z.number().int().positive(),
    /** Full team name as the XML spells it. */
    name: z.string(),
    /** Short label for the ŠSČR Event tag ("Sedlčany B"); null = derive it. */
    label: z.string().nullable(),
    /** Venue written into `Site` for the matches this team hosts; null = derive,
     *  empty string = deliberately blank. */
    site: z.string().nullable(),
});

export const manifestMatchSchema = z.object({
    no: z.number().int().positive(),
    homeTeamNo: z.number().int().positive(),
    awayTeamNo: z.number().int().positive(),
});

export const manifestRoundSchema = z.object({
    no: z.number().int().positive(),
    /** ISO `YYYY-MM-DD`, as written in the XML. */
    date: z.string(),
    matches: z.array(manifestMatchSchema),
});

export const manifestSourceSchema = z.object({
    /** Base name of the imported XML, for the "re-sync from …" prompt. */
    fileName: z.string(),
    /** Last import/re-sync, ISO 8601. */
    importedAt: z.string(),
    /** `<info><id>` — local to the Swiss-Manager install, informational only. */
    xmlId: z.string(),
    /** Cheap content fingerprint, so re-importing an unchanged file is a no-op. */
    hash: z.string(),
    byteLength: z.number().int().nonnegative(),
});

export const competitionManifestSchema = z.object({
    version: z.literal(MANIFEST_VERSION),
    source: manifestSourceSchema,
    competition: z.object({
        name: z.string(),
        /** First year of the season (2025 = 2025/26). */
        year: z.number().int().nullable(),
        boardCount: z.number().int().positive(),
        teamCount: z.number().int().nonnegative(),
        /** api.chess.cz competition id, if the leader supplied one — unlocks the
         *  shared team-shortening dictionary and player autocomplete. */
        compId: z.number().int().positive().nullable(),
    }),
    teams: z.array(manifestTeamSchema),
    rounds: z.array(manifestRoundSchema),
    options: z.object({
        /** Which roster rating feeds `WhiteElo`/`BlackElo`. */
        eloSource: z.enum(["fide", "cze"]),
        /** Event-tag prefix for the ŠSČR export ("KSA SSS 25/26"); null = derive. */
        eventPrefix: z.string().nullable(),
        /** Pattern the exported `Event` tag is composed from; null = the default
         *  "{zkratka} {domaci}-{hoste}". Defaulted, not required, so a manifest
         *  written before patterns existed still parses. */
        eventPattern: z.string().nullable().default(null),
        /** Pattern for the file name of an exported round ("{soutez}_{kolo}"). */
        filePattern: z.string().nullable().default(null),
    }),
});

export type CompetitionManifest = z.infer<typeof competitionManifestSchema>;
export type ManifestTeam = z.infer<typeof manifestTeamSchema>;

/** Working directory of a competition .pgn. */
export function workDirFor(pgnPath: string): string {
    return pgnPath.replace(/\.pgn$/i, "") + WORK_DIR_SUFFIX;
}

/** A path inside the working directory. These helpers stay synchronous — they are
 *  used in plain predicates and in tests — so the separator is read off the path
 *  itself rather than asked of Tauri: Windows paths carry backslashes, the rest "/". */
export function workFilePathFor(pgnPath: string, name: string): string {
    const dir = workDirFor(pgnPath);
    return dir + (dir.includes("\\") ? "\\" : "/") + name;
}

/** Manifest path for a competition .pgn. */
export function manifestPathFor(pgnPath: string): string {
    return workFilePathFor(pgnPath, "competition.json");
}

/** Manifest path of a competition created before the working directory existed. */
export function legacyManifestPathFor(pgnPath: string): string {
    return pgnPath.replace(/\.pgn$/i, "") + LEGACY_MANIFEST_SUFFIX;
}

/** FNV-1a (32-bit), hex. Not a security hash — just "did this file change?". */
export function contentHash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}

export type ManifestSourceInput = {
    fileName: string;
    xml: string;
    importedAt?: string;
};

/** Build a fresh manifest from a parsed competition. Existing labels/sites are not
 *  known here — `mergeManifest` carries them across a re-sync. */
export function buildManifest(
    comp: Competition,
    source: ManifestSourceInput,
    options?: Partial<CompetitionManifest["options"]> & { compId?: number | null },
): CompetitionManifest {
    return {
        version: MANIFEST_VERSION,
        source: {
            fileName: source.fileName,
            importedAt: source.importedAt ?? new Date().toISOString(),
            xmlId: comp.info.xmlId,
            hash: contentHash(source.xml),
            byteLength: source.xml.length,
        },
        competition: {
            name: comp.info.name,
            year: comp.info.year,
            boardCount: comp.info.boardCount,
            teamCount: comp.teams.length,
            compId: options?.compId ?? null,
        },
        teams: comp.teams.map((t) => ({ no: t.no, name: t.name, label: null, site: null })),
        rounds: comp.rounds.map((r) => ({
            no: r.roundNr,
            date: r.date,
            matches: r.matches.map((m) => ({
                no: m.matchNr,
                homeTeamNo: m.homeTeamNo,
                awayTeamNo: m.awayTeamNo,
            })),
        })),
        options: {
            eloSource: options?.eloSource ?? "fide",
            eventPrefix: options?.eventPrefix ?? null,
            eventPattern: options?.eventPattern ?? null,
            filePattern: options?.filePattern ?? null,
        },
    };
}

/** Re-sync: take the new file's draw and source stamp, but keep everything the
 *  leader has customised (labels, venues, compId, export options). */
export function mergeManifest(
    previous: CompetitionManifest,
    next: CompetitionManifest,
): CompetitionManifest {
    const kept = new Map(previous.teams.map((t) => [t.no, t]));
    return {
        ...next,
        competition: { ...next.competition, compId: previous.competition.compId },
        teams: next.teams.map((t) => ({
            ...t,
            label: kept.get(t.no)?.label ?? null,
            site: kept.get(t.no)?.site ?? null,
        })),
        options: previous.options,
    };
}

/** Venue per home-team number, for `buildSkeleton`. Teams without an explicit
 *  venue are left out so the caller's own default applies. */
export function siteByTeamNo(manifest: CompetitionManifest): Record<number, string> {
    const out: Record<number, string> = {};
    for (const t of manifest.teams) {
        if (t.site != null) out[t.no] = t.site;
    }
    return out;
}

/** Parse a manifest file's contents; null when it is not a manifest we understand. */
export function parseManifest(json: string): CompetitionManifest | null {
    try {
        const parsed = competitionManifestSchema.safeParse(JSON.parse(json));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export function serializeManifest(manifest: CompetitionManifest): string {
    return JSON.stringify(manifest, null, 2) + "\n";
}

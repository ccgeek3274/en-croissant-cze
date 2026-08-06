import { basename, join } from "@tauri-apps/api/path";
import { type DirEntry, exists, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { commands } from "@/bindings";
import { unwrap } from "@/utils/unwrap";

const fileTypeSchema = z.enum(["repertoire", "game", "tournament", "puzzle", "other"]);

export type FileType = z.infer<typeof fileTypeSchema>;

const fileInfoMetadataSchema = z.object({
    type: fileTypeSchema,
    tags: z.array(z.string()),
});

export type FileInfoMetadata = z.infer<typeof fileInfoMetadataSchema>;

export const fileMetadataSchema = z.object({
    type: z.literal("file"),
    name: z.string(),
    path: z.string(),
    numGames: z.number(),
    metadata: fileInfoMetadataSchema,
    lastModified: z.number(),
});

export type FileMetadata = z.infer<typeof fileMetadataSchema>;

export type FileData = {
    metadata: FileInfoMetadata;
    games: string[];
};

async function readFileMetadata(path: string): Promise<FileMetadata | null> {
    if (!path.endsWith(".pgn")) {
        return null;
    }
    const metadataPath = path.replace(".pgn", ".info");
    let metadata: FileInfoMetadata;
    if (await exists(metadataPath)) {
        metadata = JSON.parse(await readTextFile(metadataPath));
    } else {
        metadata = {
            type: "other",
            tags: [],
        };
        await writeTextFile(metadataPath, JSON.stringify(metadata));
    }
    const fileMetadata = unwrap(await commands.getFileMetadata(path));
    const numGames = unwrap(await commands.countPgnGames(path));
    return {
        type: "file",
        path,
        name: (await basename(path)).replace(".pgn", ""),
        numGames,
        metadata,
        lastModified: fileMetadata.last_modified,
    };
}

export type Directory = {
    type: "directory";
    children: (FileMetadata | Directory)[];
    path: string;
    name: string;
};

/** A competition keeps its imported XML snapshots in `<name>.xml-archiv/` beside the
 *  .pgn — inside the competition's own directory, which *is* listed, because the
 *  season is in it. The archive is bookkeeping, not a database: listing it puts an
 *  empty folder next to the season. (`<name>.competition/` is the short-lived
 *  working directory one build wrote; it is emptied and dropped on first open, and
 *  skipped here so it cannot flash up in the tree meanwhile.) */
function isSidecarDir(name: string): boolean {
    return name.endsWith(".xml-archiv") || name.endsWith(".competition");
}

export async function processEntriesRecursively(parent: string, entries: DirEntry[]) {
    const processedEntries = await Promise.all(
        entries.map(async (entry) => {
            if (entry.isFile) {
                return await readFileMetadata(await join(parent, entry.name));
            }
            if (entry.isDirectory && !isSidecarDir(entry.name)) {
                const dir = await join(parent, entry.name);
                // `dir` is already absolute (it comes from `join(parent, …)`), so no
                // baseDir: passing one asks the fs scope to resolve an absolute path
                // against AppLocalData, which throws — and one throw here rejects the
                // whole Promise.all, so a single subdirectory empties the file list.
                const newEntries = await processEntriesRecursively(dir, await readDir(dir));
                const directory: Directory = {
                    type: "directory",
                    name: entry.name,
                    path: dir,
                    children: newEntries,
                };
                return directory;
            }
            return null;
        }),
    );

    return processedEntries.filter((entry): entry is FileMetadata | Directory => entry !== null);
}

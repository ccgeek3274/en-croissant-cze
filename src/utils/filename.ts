// Filename sanitization, on its own so data-layer modules can use it without
// pulling in `utils/files.ts` (which drags along jotai atoms, tabs and bindings).

/** Strip characters no common filesystem accepts, and collapse whitespace. */
export function sanitizeFilename(name: string): string {
    return name
        .replace(/[/\\:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

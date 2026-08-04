// Opening a competition in its own tab.
//
// The competition-leader mode used to live in a full-screen modal hung off the
// Files page, which meant it existed only for as long as that page did: reopen the
// app and there was no way back into it. A tab is the app's own unit of "a thing I
// am working on", so the mode gets one — reachable from the file list, the Headers
// panel and Recent files, and restored with the rest of the session.
//
// The tab carries the competition through `gameOrigin.kind = "file"`, the same
// channel an analysis tab uses, so `getTabFile` works on it unchanged. It holds no
// move tree, so closing it never prompts to save.

import { getDefaultStore } from "jotai";
import type { FileMetadata } from "@/components/files/file";
import { addRecentFileAtom, tabsAtom } from "@/state/atoms";
import { createTab, type Tab } from "./tabs";

/** Open (or focus) the competition-leader tab for `file`. Returns the tab id. */
export async function openCompetitionTab(
    file: FileMetadata,
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>,
): Promise<string> {
    // One competition, one tab: reopening from a second entry point should come
    // back to the tab already showing it rather than stack duplicates.
    const store = getDefaultStore();
    const existing = store
        .get(tabsAtom)
        .find(
            (t) =>
                t.type === "competition" &&
                t.gameOrigin.kind === "file" &&
                t.gameOrigin.file.path === file.path,
        );
    if (existing) {
        setActiveTab(existing.value);
        return existing.value;
    }

    const id = await createTab({
        tab: { name: file.name || file.path, type: "competition" },
        setTabs,
        setActiveTab,
        gameOrigin: { kind: "file", file, gameNumber: 0 },
    });

    store.set(addRecentFileAtom, {
        name: file.name || file.path,
        path: file.path,
        type: file.metadata.type,
    });
    return id;
}

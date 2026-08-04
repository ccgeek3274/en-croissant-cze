import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileMetadata } from "@/components/files/file";
import { tabsAtom } from "@/state/atoms";
import { openCompetitionTab } from "./competitionTab";
import type { Tab } from "./tabs";

function fileAt(path: string): FileMetadata {
    return {
        type: "file",
        name: path.split("/").pop()!.replace(".pgn", ""),
        path,
        numGames: 528,
        metadata: { type: "tournament", tags: [] },
        lastModified: 0,
    };
}

/** Drive the real `setTabs`/`setActiveTab` the callers pass in. */
function harness() {
    const store = getDefaultStore();
    let active: string | null = null;
    const setTabs = (update: React.SetStateAction<Tab[]>) => {
        store.set(tabsAtom, typeof update === "function" ? update(store.get(tabsAtom)) : update);
    };
    const setActiveTab = (update: React.SetStateAction<string | null>) => {
        active = typeof update === "function" ? update(active) : update;
    };
    return {
        store,
        setTabs,
        setActiveTab,
        get active() {
            return active;
        },
    };
}

beforeEach(() => {
    getDefaultStore().set(tabsAtom, []);
});

describe("openCompetitionTab", () => {
    it("opens a competition tab carrying the file", async () => {
        const h = harness();
        const id = await openCompetitionTab(fileAt("/docs/KSA.pgn"), h.setTabs, h.setActiveTab);

        const tabs = h.store.get(tabsAtom);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]).toMatchObject({ value: id, type: "competition", name: "KSA" });
        expect(tabs[0].gameOrigin).toMatchObject({ kind: "file", gameNumber: 0 });
        expect(h.active).toBe(id);
    });

    it("focuses the tab already showing that competition instead of stacking", async () => {
        const h = harness();
        const first = await openCompetitionTab(fileAt("/docs/KSA.pgn"), h.setTabs, h.setActiveTab);
        const again = await openCompetitionTab(fileAt("/docs/KSA.pgn"), h.setTabs, h.setActiveTab);

        expect(again).toBe(first);
        expect(h.store.get(tabsAtom)).toHaveLength(1);
        expect(h.active).toBe(first);
    });

    it("gives a second competition its own tab", async () => {
        const h = harness();
        await openCompetitionTab(fileAt("/docs/KSA.pgn"), h.setTabs, h.setActiveTab);
        await openCompetitionTab(fileAt("/docs/KPB.pgn"), h.setTabs, h.setActiveTab);

        const tabs = h.store.get(tabsAtom);
        expect(tabs).toHaveLength(2);
        expect(tabs.map((t) => t.name)).toEqual(["KSA", "KPB"]);
    });

    it("carries no move tree, so closing it never prompts to save", async () => {
        const h = harness();
        const id = await openCompetitionTab(fileAt("/docs/KSA.pgn"), h.setTabs, h.setActiveTab);
        expect(sessionStorage.getItem(id)).toBeNull();
    });
});

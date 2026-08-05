import { describe, expect, it } from "vitest";
import { claimFileDrop, isFileDropClaimed } from "./fileDrop";

describe("fileDrop", () => {
    it("is unclaimed until someone claims it", () => {
        expect(isFileDropClaimed()).toBe(false);
        const release = claimFileDrop();
        expect(isFileDropClaimed()).toBe(true);
        release();
        expect(isFileDropClaimed()).toBe(false);
    });

    it("keeps the claim while any holder still wants it", () => {
        // Two dialogs overlap during a close animation; the one going away must not
        // hand the drop back to the app-wide "open as a new database" handler.
        const first = claimFileDrop();
        const second = claimFileDrop();
        first();
        expect(isFileDropClaimed()).toBe(true);
        second();
        expect(isFileDropClaimed()).toBe(false);
    });

    it("ignores a release called twice", () => {
        const a = claimFileDrop();
        const b = claimFileDrop();
        a();
        a();
        expect(isFileDropClaimed()).toBe(true);
        b();
        expect(isFileDropClaimed()).toBe(false);
    });
});

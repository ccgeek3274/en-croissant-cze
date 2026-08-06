// Real render test for the "Import moves" dialog — the layer where the earlier
// bugs actually lived (raw i18n keys leaking, empty plural forms). It renders the
// component through real Mantine + real i18next with the shipped en-US resources,
// mocking only the Tauri boundary, and asserts the DOM never shows a raw
// "PgnTools.*" key and that the reported "…WillAppend" text resolves to real copy.

import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enUS from "@/translation/en-US.json";
import { isFileDropClaimed } from "@/utils/fileDrop";

const { TARGET, drop, fileTexts } = vi.hoisted(() => ({
  TARGET: `[Event "Cup"]
[Round "1.1"]
[White "Kovar, Jiri"]
[Black "Novak, Petr"]
[Result "*"]

*`,
  // The registered Tauri drag-drop listener, so a test can fire a real drop.
  drop: { fire: null as null | ((payload: unknown) => void) },
  // path → contents, for readTextFile.
  fileTexts: new Map<string, string>(),
}));

// Tauri boundary — the component reads existing games through commands.readGames.
vi.mock("@/bindings", () => ({
  commands: { readGames: vi.fn(async () => ({ status: "ok", data: [TARGET] })) },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (p: string) => fileTexts.get(p) ?? ""),
  writeTextFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (e: { payload: unknown }) => void) => {
      drop.fire = (payload) => handler({ payload });
      return () => {
        drop.fire = null;
      };
    },
  }),
}));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));
// ECO lookup goes through the Rust opening book; stand in for it by reading the
// first move, which is all the assertions below need.
vi.mock("@/utils/chess", () => ({
  getEcoFromGame: vi.fn(async (pgn: string) =>
    pgn.includes("1. e4") ? "C20" : pgn.includes("1. d4") ? "D00" : "",
  ),
}));

// The dialog is imported after the mocks are registered.
import { notifications } from "@mantine/notifications";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { ImportGamesModal } from "./PgnToolsDialogs";

const FILE = {
  type: "file" as const,
  name: "match",
  path: "/tmp/match.pgn",
  numGames: 1,
  metadata: { type: "tournament" as const, tags: [] },
  lastModified: 0,
};

// Two imported games: one matches the target (both surnames), one is a leftover.
const IMPORTED_TWO = `[Event "Cup"]
[Round "1.1"]
[White "Kovar, Jiri"]
[Black "Novak, Petr"]
[Result "1-0"]

1. e4 e5 1-0


[Event "Cup"]
[Round "1.2"]
[White "Foreign, A"]
[Black "Stranger, B"]
[Result "0-1"]

1. d4 d5 0-1`;

beforeAll(async () => {
  // jsdom lacks these; Mantine's Modal / ScrollArea / Select need them.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};

  await i18n.use(initReactI18next).init({
    lng: "en-US",
    fallbackLng: "en-US",
    returnEmptyString: false,
    resources: { "en-US": { translation: enUS.translation } },
  });
});

afterEach(() => {
  cleanup();
  fileTexts.clear();
  drop.fire = null;
  vi.mocked(openDialog).mockReset();
  vi.mocked(writeTextFile).mockClear();
  vi.mocked(notifications.show).mockClear();
});

/** One game per file, the way captains actually send them. */
function seedFiles(...names: string[]) {
  names.forEach((name, i) => {
    fileTexts.set(
      name,
      `[Event "Cup"]\n[Round "1.${i + 1}"]\n[White "P${i}, A"]\n[Black "Q${i}, B"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    );
  });
  return names;
}

function renderModal() {
  return render(
    <MantineProvider>
      <ImportGamesModal opened onClose={() => {}} file={FILE} onChanged={() => {}} />
    </MantineProvider>,
  );
}

describe("ImportGamesModal", () => {
  it('renders the renamed title and never leaks a raw "PgnTools.*" key', async () => {
    renderModal();
    // Title reflects the rename to "Import moves".
    expect(await screen.findByText("Import moves")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PgnTools\./);
  });

  it("shows real level labels and a resolved WillAppend line when a game is left over", async () => {
    renderModal();
    await screen.findByText("Import moves");

    const textarea = screen.getByPlaceholderText(/paste PGN/i);
    fireEvent.change(textarea, { target: { value: IMPORTED_TWO } });

    // The matched row's confidence badge is real translated text, not "Level2".
    expect(await screen.findByText("Both players")).toBeTruthy();

    // The exact bug the user hit: with one leftover import, the append notice must
    // be resolved copy — not the raw "PgnTools.Import.WillAppend" key.
    expect(screen.getByText(/will be appended/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PgnTools\./);
  });

  it("loads the games of every picked file at once", async () => {
    const picked = seedFiles("/in/board1.pgn", "/in/board2.pgn", "/in/board3.pgn");
    vi.mocked(openDialog).mockResolvedValue(picked as never);
    renderModal();
    await screen.findByText("Import moves");

    fireEvent.click(screen.getByText("Choose files…"));

    // Three files, one game each → three games offered, and the count is stated.
    expect(await screen.findByText("Loaded from 3 files.")).toBeTruthy();
    // One of them pairs with the single target; the other two are appended — which
    // only adds up if all three files were read.
    expect(screen.getByText(/2 imported games match no existing game/i)).toBeTruthy();
  });

  it("writes an ECO tag computed from the imported moves, merged and appended alike", async () => {
    renderModal();
    await screen.findByText("Import moves");

    fireEvent.change(screen.getByPlaceholderText(/paste PGN/i), {
      target: { value: IMPORTED_TWO },
    });
    await screen.findByText("Both players");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalled());
    const written = vi.mocked(writeTextFile).mock.calls[0][1] as string;
    // The target had no ECO; it gets the code of the moves it just received (1. e4),
    // and the leftover import is appended with its own (1. d4).
    expect(written).toMatch(/\[ECO "C20"\]/);
    expect(written).toMatch(/\[ECO "D00"\]/);

    // The summary says so, in resolved copy rather than a raw key.
    const { message } = vi.mocked(notifications.show).mock.calls[0][0] as { message: string };
    expect(message).toContain("ECO codes computed for 2 games.");
  });

  it("claims dropped files while open, so they are not opened as databases", async () => {
    expect(isFileDropClaimed()).toBe(false);
    const view = renderModal();
    await screen.findByText("Import moves");
    expect(isFileDropClaimed()).toBe(true);
    view.unmount();
    expect(isFileDropClaimed()).toBe(false);
  });

  it("takes dropped files, ignoring anything that is not a .pgn", async () => {
    seedFiles("/in/board1.pgn", "/in/board2.pgn");
    renderModal();
    await screen.findByText("Import moves");

    await vi.waitFor(() => expect(drop.fire).toBeTruthy());
    drop.fire?.({ type: "drop", paths: ["/in/board1.pgn", "/in/notes.txt", "/in/board2.pgn"] });

    expect(await screen.findByText("Loaded from 2 files.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PgnTools\./);
  });
});

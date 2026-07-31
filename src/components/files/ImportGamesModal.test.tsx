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

const { TARGET } = vi.hoisted(() => ({
  TARGET: `[Event "Cup"]
[Round "1.1"]
[White "Kovar, Jiri"]
[Black "Novak, Petr"]
[Result "*"]

*`,
}));

// Tauri boundary — the component reads existing games through commands.readGames.
vi.mock("@/bindings", () => ({
  commands: { readGames: vi.fn(async () => ({ status: "ok", data: [TARGET] })) },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));

// The dialog is imported after the mocks are registered.
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

afterEach(cleanup);

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
});

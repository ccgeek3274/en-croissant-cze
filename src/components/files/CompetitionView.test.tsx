// Render test for the competition-leader mode: the tree, the scoped games grid and
// the scoped header editor. What matters here is that selecting a node really
// narrows what the right-hand side operates on, that the selection survives the tab
// unmounting, and that it reaches the board with the game — that is the whole point
// of the mode, and it is invisible to the pure tree tests.

import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "@/translation/en-US.json";
import { splitPgnGames } from "@/utils/pgn/tags";
import { competitionXml, parseFixture } from "@/utils/sscr/__fixtures__";
import { buildManifest, manifestPathFor, serializeManifest } from "@/utils/sscr/manifest";
import { buildSkeleton, skeletonToPgn } from "@/utils/sscr/skeleton";
import type { GameScope } from "@/utils/tabs";

const PGN_PATH = "/docs/KSA.pgn";

const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock("@tauri-apps/api/path", () => ({
  basename: vi.fn(async (p: string) => p.split("/").pop() ?? p),
  resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => files.has(p)),
  mkdir: vi.fn(async () => {}),
  readTextFile: vi.fn(async (p: string) => files.get(p) ?? ""),
  writeTextFile: vi.fn(async (p: string, text: string) => {
    files.set(p, text);
  }),
}));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));
vi.mock("@/bindings", () => ({
  commands: {
    readGames: vi.fn(async (path: string, start: number, end: number) => ({
      status: "ok",
      data: splitPgnGames(files.get(path) ?? "").slice(start, end + 1),
    })),
  },
}));

import { CompetitionView } from "./CompetitionView";

const FILE = {
  type: "file" as const,
  name: "KSA",
  path: PGN_PATH,
  numGames: 192,
  metadata: { type: "tournament" as const, tags: [] },
  lastModified: 0,
};

beforeAll(async () => {
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

beforeEach(() => {
  // The view remembers the selected node per file (see `saveTreeState`), and jsdom's
  // localStorage outlives a single test — without this, each test would start on
  // whatever node the previous one clicked.
  localStorage.clear();
  files.clear();
  const comp = parseFixture();
  files.set(PGN_PATH, skeletonToPgn(buildSkeleton(comp, { eloSource: "fide" })));
  files.set(
    manifestPathFor(PGN_PATH),
    serializeManifest(buildManifest(comp, { fileName: "3005.XML", xml: competitionXml })),
  );
});

afterEach(cleanup);

function renderView(onOpenGame: (index: number, scope: GameScope) => void = () => {}) {
  return render(
    <MantineProvider>
      <CompetitionView file={FILE} onChanged={() => {}} onOpenGame={onOpenGame} />
    </MantineProvider>,
  );
}

/** The scoped tag editor sits behind a disclosure so the grid has the room. */
function openTagEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Headers at this level" }));
}

/** Data rows of the games grid, header row excluded. */
function gameRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

describe("CompetitionView", () => {
  // jsdom renders the full 192-row table for real; give the cold first render room.
  it("opens on the whole competition and shows its totals", { timeout: 20000 }, async () => {
    renderView();
    // The name shows in the header, in the scope label and as the Event value.
    expect(
      (await screen.findAllByText("Krajská soutěž SŠS 2025/26 - skupina A")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Whole competition")).toBeTruthy();
    expect(screen.getByText("0/192")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Competition\.[A-Z]/);
  });

  // Layout regression, verified in a real browser: Mantine's Group wraps by default,
  // and in a multi-line flex container `align-items: stretch` sizes items to their
  // own line — so both panes grew to their content (a 4600px tree inside a 600px
  // pane) and neither ScrollArea had anything to clip. jsdom computes no layout, so
  // the guard is the prop itself, which is the thing that must not be dropped.
  it("keeps the two panes on one flex line, or nothing scrolls", async () => {
    const { container } = renderView();
    await screen.findByText("Whole competition");
    const panes = container.querySelector<HTMLElement>('[style*="--group-wrap"][style*="stretch"]');
    expect(panes).toBeTruthy();
    expect(panes?.getAttribute("style")).toContain("--group-wrap: nowrap");
  });

  it("expands round → match → game and labels each level", async () => {
    renderView();
    await screen.findByText("Whole competition");

    // Rounds are listed under the root, which starts expanded.
    expect(screen.getByText(/Round 1 · 2025-10-12/)).toBeTruthy();
    expect(screen.getByText(/Round 10 · 2026-03-15/)).toBeTruthy();

    // Selecting round 1 opens it → its six matches, with scores.
    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    const match = await screen.findAllByText("ŠK KDJS Sedlčany A – Klokani z Kralup");
    expect(match.length).toBeGreaterThan(0);
    // Three of round 1's six matches ended 2.5:5.5.
    expect(screen.getAllByText("2.5:5.5")).toHaveLength(3);

    // …and selecting the match opens its eight boards.
    fireEvent.click(match[0]);
    expect(await screen.findByText("1. Šimák, Roman – Hánl, František")).toBeTruthy();
  });

  it("narrows the games grid to the selected node", async () => {
    renderView();
    await screen.findByText("Whole competition");

    // Competition scope: every game is listed.
    expect(gameRows()).toHaveLength(192);

    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    expect(await screen.findByText("1. kolo")).toBeTruthy();
    expect(gameRows()).toHaveLength(48);

    // …down to the eight boards of one match.
    fireEvent.click(screen.getAllByText("ŠK KDJS Sedlčany A – Klokani z Kralup")[0]);
    await vi.waitFor(() => expect(gameRows()).toHaveLength(8));
  });

  // The grid is the board's "Hlavičky" view, so the tag columns come with it — the
  // point of reusing it is that a leader edits headers here in the same shape they
  // see on the board.
  it("shows the games as the Headers grid, with its tag columns", async () => {
    renderView();
    await screen.findByText("Whole competition");

    const head = within(screen.getByRole("table")).getAllByRole("row")[0];
    expect(within(head).getByText("Event")).toBeTruthy();
    expect(within(head).getByText("Round")).toBeTruthy();
    expect(within(head).getByText("ECO")).toBeTruthy();

    // Row 1 is board 1 of match 1.1, and it carries the file's game number.
    const first = gameRows()[0];
    expect(within(first).getByText("1")).toBeTruthy();
    expect(within(first).getByText("Šimák, Roman")).toBeTruthy();
    expect(within(first).getByText("1.1.1")).toBeTruthy();
  });

  // Tab panels unmount on switch (`keepMounted={false}`), so this is the difference
  // between coming back where you left off and coming back at the root.
  it("comes back to the node it was left on", async () => {
    const first = renderView();
    await screen.findByText("Whole competition");
    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    fireEvent.click(await screen.findByText("ŠK KDJS Sedlčany A – Klokani z Kralup"));
    await vi.waitFor(() => expect(gameRows()).toHaveLength(8));
    first.unmount();

    renderView();
    // Straight back to the match: its eight boards, without touching the tree.
    await vi.waitFor(() => expect(gameRows()).toHaveLength(8));
    expect(screen.getAllByText("ŠK KDJS Sedlčany A – Klokani z Kralup").length).toBeGreaterThan(0);
  });

  it("scopes the header editor to the selection", async () => {
    renderView();
    await screen.findByText("Whole competition");
    openTagEditor();

    // Event is uniform across the whole file, so one value covering all 192 games.
    expect(screen.getByText("192×")).toBeTruthy();
    expect(screen.getByText(/· 192 games/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    expect(await screen.findByText(/· 48 games/)).toBeTruthy();
    expect(screen.getByText("48×")).toBeTruthy();
  });

  it("rewrites a tag only inside the selected scope", async () => {
    renderView();
    await screen.findByText("Whole competition");
    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    openTagEditor();
    await screen.findByText(/· 48 games/);

    // Tick the single Event value in scope and give it a new one.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("Desired value (empty = clear)"), {
      target: { value: "KSA SSS 25/26" },
    });
    fireEvent.click(screen.getByText("Replace selected (1)"));

    await vi.waitFor(() => expect(files.get(PGN_PATH)).toContain('[Event "KSA SSS 25/26"]'));
    const written = splitPgnGames(files.get(PGN_PATH)!);
    expect(written.filter((g) => g.includes('[Event "KSA SSS 25/26"]'))).toHaveLength(48);
    // Rounds 6, 8 and 10 keep the original Event.
    expect(
      written.filter((g) => g.includes('[Event "Krajská soutěž SŠS 2025/26 - skupina A"]')),
    ).toHaveLength(144);
  });

  it("hands the file index of a game to the board", async () => {
    const onOpenGame = vi.fn();
    renderView(onOpenGame);
    await screen.findByText("Whole competition");

    fireEvent.click(gameRows()[0]);
    expect(onOpenGame).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ indices: expect.any(Array) }),
    );
  });

  // Opening a game out of a match should not drop the leader onto a board listing
  // all 192 games of the season: the level travels with the game.
  it("hands the selected level to the board along with the game", async () => {
    const onOpenGame = vi.fn();
    renderView(onOpenGame);
    await screen.findByText("Whole competition");
    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    fireEvent.click(await screen.findByText("ŠK KDJS Sedlčany A – Klokani z Kralup"));
    await vi.waitFor(() => expect(gameRows()).toHaveLength(8));

    fireEvent.click(gameRows()[2]);
    const [index, scope] = onOpenGame.mock.calls[0];
    expect(scope.indices).toHaveLength(8);
    expect(scope.indices).toContain(index);
    expect(scope.matchLevel).toBe(true);
    expect(scope.label).toContain("Sedlčany");
  });
});

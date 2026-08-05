// Render test for the competition-leader mode: the tree, the scoped detail table
// and the scoped header editor. What matters here is that selecting a node really
// narrows what the right-hand side operates on — that is the whole point of the
// mode, and it is invisible to the pure tree tests.

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
  files.clear();
  const comp = parseFixture();
  files.set(PGN_PATH, skeletonToPgn(buildSkeleton(comp, { eloSource: "fide" })));
  files.set(
    manifestPathFor(PGN_PATH),
    serializeManifest(buildManifest(comp, { fileName: "3005.XML", xml: competitionXml })),
  );
});

afterEach(cleanup);

function renderView(onOpenGame = () => {}) {
  return render(
    <MantineProvider>
      <CompetitionView file={FILE} onChanged={() => {}} onOpenGame={onOpenGame} />
    </MantineProvider>,
  );
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

  it("narrows the detail table to the selected node", async () => {
    renderView();
    await screen.findByText("Whole competition");

    // Competition scope: every game is listed.
    const rows = () => within(screen.getByRole("table")).getAllByRole("row").length - 1;
    expect(rows()).toBe(192);

    fireEvent.click(screen.getByText(/Round 1 · 2025-10-12/));
    expect(await screen.findByText("1. kolo")).toBeTruthy();
    expect(rows()).toBe(48);
  });

  it("scopes the header editor to the selection", async () => {
    renderView();
    await screen.findByText("Whole competition");

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

    fireEvent.click(
      within(screen.getByRole("table")).getAllByRole("row")[1].querySelector("button")!,
    );
    expect(onOpenGame).toHaveBeenCalledWith(0);
  });
});

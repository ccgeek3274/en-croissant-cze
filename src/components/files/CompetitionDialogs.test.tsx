// Real render test for the competition dialogs. Same rationale as
// ImportGamesModal.test.tsx: the interesting failures (raw i18n keys, empty plural
// forms, a crash on the empty state) only show up once the component is rendered
// through real Mantine + real i18next. Only the Tauri boundary is mocked.

import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "@/translation/en-US.json";
import { competitionXml, parseFixture } from "@/utils/sscr/__fixtures__";
import {
  buildManifest,
  manifestPathFor,
  parseManifest,
  serializeManifest,
} from "@/utils/sscr/manifest";
import { buildSkeleton, skeletonToPgn } from "@/utils/sscr/skeleton";

const PGN_PATH = "/docs/KSA.pgn";

const { picked, files } = vi.hoisted(() => ({
  picked: { path: null as string | null },
  files: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: vi.fn(async (p: string) => p.split("/").pop() ?? p),
  resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => picked.path) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => files.has(p)),
  mkdir: vi.fn(async () => {}),
  readTextFile: vi.fn(async (p: string) => {
    const text = files.get(p);
    if (text === undefined) throw new Error(`no such file: ${p}`);
    return text;
  }),
  writeTextFile: vi.fn(async (p: string, text: string) => {
    files.set(p, text);
  }),
}));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));

// Imported after the mocks are registered.
import { CompetitionImportModal, CompetitionResyncModal } from "./CompetitionDialogs";

beforeAll(async () => {
  // jsdom lacks these; Mantine's Modal / ScrollArea need them.
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
  picked.path = null;
});

afterEach(cleanup);

function noRawKeys() {
  expect(document.body.textContent).not.toMatch(/Competition\.[A-Z]/);
}

describe("CompetitionImportModal", () => {
  function renderModal(onCreated = () => {}) {
    return render(
      <MantineProvider>
        <CompetitionImportModal opened onClose={() => {}} dir="/docs" onCreated={onCreated} />
      </MantineProvider>,
    );
  }

  it("renders its empty state without leaking a raw key", async () => {
    renderModal();
    expect(await screen.findByText("New competition from XML")).toBeTruthy();
    noRawKeys();
  });

  it("previews a picked XML: header, counts and per-round state", async () => {
    picked.path = "/xml/3005.XML";
    files.set(picked.path, competitionXml);
    renderModal();
    await screen.findByText("New competition from XML");

    fireEvent.click(screen.getByText("Choose XML…"));

    expect(await screen.findByText("Krajská soutěž SŠS 2025/26 - skupina A")).toBeTruthy();
    expect(screen.getByText("192")).toBeTruthy(); // 4 rounds × 6 matches × 8 boards
    expect(screen.getByText(/Round 10 · 2026-03-15/)).toBeTruthy();
    expect(screen.getAllByText("played")).toHaveLength(3);
    expect(screen.getByText("not played")).toBeTruthy();
    noRawKeys();
  });

  it("writes the .pgn, the .info and the manifest on create", async () => {
    picked.path = "/xml/3005.XML";
    files.set(picked.path, competitionXml);
    const onCreated = vi.fn();
    renderModal(onCreated);
    await screen.findByText("New competition from XML");
    fireEvent.click(screen.getByText("Choose XML…"));
    await screen.findByText("Krajská soutěž SŠS 2025/26 - skupina A");

    fireEvent.click(screen.getByText("Create competition"));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    const pgnPath = onCreated.mock.calls[0][0] as string;
    expect(pgnPath).toBe("/docs/Krajská soutěž SŠS 2025-26 - skupina A.pgn");
    expect(files.get(pgnPath)).toContain('[Round "1.1.1"]');
    expect(JSON.parse(files.get(pgnPath.replace(".pgn", ".info"))!)).toEqual({
      type: "tournament",
      tags: [],
    });
    expect(files.get(manifestPathFor(pgnPath))).toContain('"version": 1');
  });

  it("prefills the Event prefix and a short label for every team", async () => {
    picked.path = "/xml/3005.XML";
    files.set(picked.path, competitionXml);
    const onCreated = vi.fn();
    renderModal(onCreated);
    await screen.findByText("New competition from XML");
    fireEvent.click(screen.getByText("Choose XML…"));
    await screen.findByText("Krajská soutěž SŠS 2025/26 - skupina A");
    fireEvent.click(screen.getByText("Create competition"));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    const manifest = parseManifest(
      files.get(manifestPathFor(onCreated.mock.calls[0][0] as string))!,
    )!;
    expect(manifest.options.eventPrefix).toBe("KSA 25/26");
    // Every team is labelled, diacritics-free, and keeps its team letter.
    expect(manifest.teams.every((team) => !!team.label)).toBe(true);
    expect(manifest.teams.find((team) => team.no === 1)!.label).toBe("Sedlcany A");
    expect(manifest.teams.find((team) => team.no === 10)!.label).toBe("Neratovice B");
  });
});

describe("CompetitionResyncModal", () => {
  /** Seed a competition on disk whose round 1 line-up has been blanked out. */
  function seedCompetition() {
    const comp = parseFixture();
    const skeleton = buildSkeleton(comp, { eloSource: "fide" });
    const pgn = skeletonToPgn(skeleton)
      .replace('[White "Šimák, Roman"]', '[White "Domácí 1"]')
      .replace('[Black "Hánl, František"]', '[Black "Hosté 1"]');
    files.set(PGN_PATH, pgn);
    files.set(
      manifestPathFor(PGN_PATH),
      serializeManifest(buildManifest(comp, { fileName: "old.XML", xml: "<old/>" })),
    );
  }

  function renderModal(onChanged = () => {}) {
    return render(
      <MantineProvider>
        <CompetitionResyncModal
          opened
          onClose={() => {}}
          pgnPath={PGN_PATH}
          onChanged={onChanged}
        />
      </MantineProvider>,
    );
  }

  it("renders its empty state without leaking a raw key", async () => {
    renderModal();
    expect(await screen.findByText("Update from XML")).toBeTruthy();
    noRawKeys();
  });

  it("reports what the newer XML would fill in", async () => {
    seedCompetition();
    picked.path = "/xml/3005-new.XML";
    files.set(picked.path, competitionXml);
    renderModal();
    await screen.findByText("Update from XML");

    fireEvent.click(screen.getByText("Choose XML…"));

    // "Filled in" shows twice: as a count label and as the row's badge.
    expect(await screen.findAllByText("Filled in")).toHaveLength(2);
    // One game was blanked out, so exactly one row is a fill and the rest unchanged.
    expect(screen.getByText(/1\.1\.1 · Domácí 1 – Hosté 1/)).toBeTruthy();
    expect(screen.getByText(/White: Domácí 1 → Šimák, Roman/)).toBeTruthy();
    noRawKeys();
  });

  it("applies the plan and rewrites the file", async () => {
    seedCompetition();
    picked.path = "/xml/3005-new.XML";
    files.set(picked.path, competitionXml);
    const onChanged = vi.fn();
    renderModal(onChanged);
    await screen.findByText("Update from XML");
    fireEvent.click(screen.getByText("Choose XML…"));
    await screen.findAllByText("Filled in");

    fireEvent.click(screen.getByText("Apply"));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(files.get(PGN_PATH)).toContain('[White "Šimák, Roman"]');
    expect(files.get(manifestPathFor(PGN_PATH))).toContain('"fileName": "3005-new.XML"');
  });

  it("says so when the XML brings nothing new", async () => {
    const comp = parseFixture();
    files.set(PGN_PATH, skeletonToPgn(buildSkeleton(comp, { eloSource: "fide" })));
    files.set(
      manifestPathFor(PGN_PATH),
      serializeManifest(buildManifest(comp, { fileName: "3005.XML", xml: competitionXml })),
    );
    picked.path = "/xml/3005.XML";
    files.set(picked.path, competitionXml);
    renderModal();
    await screen.findByText("Update from XML");

    fireEvent.click(screen.getByText("Choose XML…"));

    expect(await screen.findByText("The competition already matches this XML.")).toBeTruthy();
    expect(
      screen.getByText("This is byte for byte the XML that was imported last time."),
    ).toBeTruthy();
    noRawKeys();
  });
});

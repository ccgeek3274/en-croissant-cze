// Render test for the ŠSČR deliverable: the label directory persists into the
// manifest, and the export writes a file whose shape matches the reference
// bulletin (two-level Round, short Event, no diacritics).

import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "@/translation/en-US.json";
import { getTag, splitGame, splitPgnGames } from "@/utils/pgn/tags";
import { competitionXml, parseFixture } from "@/utils/sscr/__fixtures__";
import {
  buildManifest,
  manifestPathFor,
  parseManifest,
  serializeManifest,
} from "@/utils/sscr/manifest";
import { buildSkeleton, skeletonToPgn } from "@/utils/sscr/skeleton";

const PGN_PATH = "/docs/KSA.pgn";
const SAVE_PATH = "/out/kolo-1.pgn";

const { files, saveTo } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  saveTo: { path: null as string | null },
}));

vi.mock("@tauri-apps/api/path", () => ({
  basename: vi.fn(async (p: string) => p.split("/").pop() ?? p),
  resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(async () => saveTo.path),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => files.has(p)),
  mkdir: vi.fn(async () => {}),
  readTextFile: vi.fn(async (p: string) => files.get(p) ?? ""),
  writeTextFile: vi.fn(async (p: string, text: string) => {
    files.set(p, text);
  }),
}));
vi.mock("@mantine/notifications", () => ({ notifications: { show: vi.fn() } }));

import { CompetitionLabelsDialog, SscrExportModal } from "./SscrExportDialogs";

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

/** Seed a competition whose round 1 has moves and short labels already set. */
function seed(withLabels: boolean) {
  const comp = parseFixture();
  const games = splitPgnGames(skeletonToPgn(buildSkeleton(comp, { eloSource: "fide" }))).map((g) =>
    splitGame(g).tags.map.Round.startsWith("1.")
      ? `${g.replace(/\n\n[^\n]*$/, "")}\n\n1. d4 Nf6 ${splitGame(g).tags.map.Result}`
      : g,
  );
  files.set(PGN_PATH, games.join("\n\n\n") + "\n");

  const manifest = buildManifest(comp, { fileName: "3005.XML", xml: competitionXml });
  manifest.options.eventPrefix = "KSA SSS 25/26";
  if (withLabels) {
    for (const team of manifest.teams) manifest.teams[team.no - 1].label = `T${team.no}`;
  }
  files.set(manifestPathFor(PGN_PATH), serializeManifest(manifest));
}

beforeEach(() => {
  files.clear();
  saveTo.path = SAVE_PATH;
});

afterEach(cleanup);

describe("CompetitionLabelsDialog", () => {
  function renderDialog(onSaved = () => {}) {
    return render(
      <MantineProvider>
        <CompetitionLabelsDialog opened onClose={() => {}} pgnPath={PGN_PATH} onSaved={onSaved} />
      </MantineProvider>,
    );
  }

  it("lists every team and shows the stored prefix", async () => {
    seed(false);
    renderDialog();
    expect(await screen.findByDisplayValue("KSA SSS 25/26")).toBeTruthy();
    expect(screen.getByText("ŠK KDJS Sedlčany A")).toBeTruthy();
    expect(screen.getByText("Klokani z Kralup")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Competition\.[A-Z]/);
  });

  it("fills empty labels from the bundled club dictionary", async () => {
    seed(false);
    renderDialog();
    await screen.findByDisplayValue("KSA SSS 25/26");

    const field = screen.getByLabelText("Short label — ŠK KDJS Sedlčany A") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.click(screen.getByText("Suggest empty ones"));
    expect(field.value).not.toBe("");
  });

  it("writes the prefix and the labels into the manifest", async () => {
    seed(false);
    const onSaved = vi.fn();
    renderDialog(onSaved);
    await screen.findByDisplayValue("KSA SSS 25/26");

    fireEvent.change(screen.getByLabelText("Short label — Klokani z Kralup"), {
      target: { value: "Kralupy B" },
    });
    fireEvent.change(screen.getByLabelText("Venue (Site) — Klokani z Kralup"), {
      target: { value: "Kralupy" },
    });
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const manifest = parseManifest(files.get(manifestPathFor(PGN_PATH))!)!;
    expect(manifest.options.eventPrefix).toBe("KSA SSS 25/26");
    expect(manifest.teams.find((team) => team.no === 12)).toMatchObject({
      label: "Kralupy B",
      site: "Kralupy",
    });
    // Games are untouched — this only edits the directory.
    expect(files.get(PGN_PATH)).toContain('[Event "Krajská soutěž SŠS 2025/26 - skupina A"]');
  });
});

describe("SscrExportModal", () => {
  function renderModal(indices?: number[]) {
    return render(
      <MantineProvider>
        <SscrExportModal
          opened
          onClose={() => {}}
          pgnPath={PGN_PATH}
          indices={indices}
          scopeLabel="1. kolo"
          defaultFileName="KSA-1"
        />
      </MantineProvider>,
    );
  }

  it("preflights the scope before writing anything", async () => {
    seed(true);
    renderModal([...Array(48).keys()]); // round 1
    expect(await screen.findByText("Export ŠSČR — 1. kolo")).toBeTruthy();
    expect(screen.getByText("Everything is in place.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Competition\.[A-Z]/);
  });

  it("warns about matches with no moves and teams with no label", async () => {
    seed(false);
    renderModal(); // whole competition: rounds 6/8/10 have no moves at all
    await screen.findByText("Export ŠSČR — 1. kolo");
    expect(screen.getByText(/matches have no moves at all/)).toBeTruthy();
    expect(screen.getByText(/No short label for/)).toBeTruthy();
  });

  it("writes the ŠSČR profile: two-level Round, short Event, no diacritics", async () => {
    seed(true);
    renderModal([...Array(48).keys()]);
    await screen.findByText("Export ŠSČR — 1. kolo");

    fireEvent.click(screen.getByText("Export"));

    await vi.waitFor(() => expect(files.get(SAVE_PATH)).toBeTruthy());
    const exported = splitPgnGames(files.get(SAVE_PATH)!);
    expect(exported).toHaveLength(48);
    const first = splitGame(exported[0]);
    expect(getTag(first.tags, "Round")).toBe("1.1");
    expect(getTag(first.tags, "Event")).toBe("KSA SSS 25/26 T1-T12");
    expect(getTag(first.tags, "White")).toBe("Simak, Roman");
    expect(first.tags.order).not.toContain("WhiteTeam");
    expect(files.get(SAVE_PATH)).not.toMatch(/[ěščřžýáíé]/);
    // The database itself keeps the full format.
    expect(files.get(PGN_PATH)).toContain('[WhiteTeam "ŠK KDJS Sedlčany A"]');
  });

  it("keeps diacritics and forfeits when the options are turned off", async () => {
    seed(true);
    renderModal();
    await screen.findByText("Export ŠSČR — 1. kolo");

    fireEvent.click(screen.getByLabelText("Strip diacritics"));
    fireEvent.click(screen.getByLabelText("Drop forfeits nobody played"));
    fireEvent.click(screen.getByText("Export"));

    await vi.waitFor(() => expect(files.get(SAVE_PATH)).toBeTruthy());
    expect(splitPgnGames(files.get(SAVE_PATH)!)).toHaveLength(192);
    expect(files.get(SAVE_PATH)).toContain("Šimák, Roman");
  });
});

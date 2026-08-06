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

import { CompetitionLabelsDialog, MatchLabelsDialog, SscrExportModal } from "./SscrExportDialogs";

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

  it("arrives with labels and venues already filled in", async () => {
    seed(false); // manifest with nothing stored, as before the directory existed
    renderDialog();
    await screen.findByDisplayValue("KSA SSS 25/26");

    const label = screen.getByLabelText("Short label — ŠK KDJS Sedlčany A") as HTMLInputElement;
    const site = screen.getByLabelText("Venue (Site) — ŠK KDJS Sedlčany A") as HTMLInputElement;
    expect(label.value).toBe("Sedlcany A");
    expect(site.value).toBe("Sedlcany"); // the venue is the label minus the team letter

    // Emptied by hand, "Suggest empty ones" puts both back.
    fireEvent.change(label, { target: { value: "" } });
    fireEvent.change(site, { target: { value: "" } });
    fireEvent.click(screen.getByText("Suggest empty ones"));
    expect(label.value).toBe("Sedlcany A");
    expect(site.value).toBe("Sedlcany");
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

  it("previews the name patterns on this competition's own data", async () => {
    seed(true); // labels T1…T12
    renderDialog();
    await screen.findByDisplayValue("KSA SSS 25/26");

    // The fields carry the default as editable text, and preview what it produces.
    expect((screen.getByLabelText("Event tag") as HTMLInputElement).value).toBe(
      "{zkratka} {domaci}-{hoste}",
    );
    expect((screen.getByLabelText("Round file name") as HTMLInputElement).value).toBe(
      "{soutez}_{kolo}",
    );
    expect(screen.getByText("Preview: KSA SSS 25/26 T1-T12")).toBeTruthy();
    expect(screen.getByText("Preview: ksa_01.pgn")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Event tag"), {
      target: { value: "{zkratka} {kolo}. kolo: {domaci} vs {hoste}" },
    });
    fireEvent.change(screen.getByLabelText("Round file name"), {
      target: { value: "KSA-kolo{kolo}_ŠSČR" },
    });
    expect(screen.getByText("Preview: KSA SSS 25/26 01. kolo: T1 vs T12")).toBeTruthy();
    expect(screen.getByText("Preview: KSA-kolo01_SSCR.pgn")).toBeTruthy();
  });

  it("stores the patterns; the default and an emptied field both mean none", async () => {
    seed(true);
    const onSaved = vi.fn();
    renderDialog(onSaved);
    await screen.findByDisplayValue("KSA SSS 25/26");

    fireEvent.change(screen.getByLabelText("Event tag"), {
      target: { value: "{zkratka} {domaci} vs {hoste}" },
    });
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(parseManifest(files.get(manifestPathFor(PGN_PATH))!)!.options).toMatchObject({
      eventPattern: "{zkratka} {domaci} vs {hoste}",
      filePattern: null,
    });

    // Reopened, the field shows the stored pattern; the reset button puts the
    // default back, and saving that stores null again rather than the literal text.
    cleanup();
    renderDialog(onSaved);
    await screen.findByDisplayValue("{zkratka} {domaci} vs {hoste}");
    fireEvent.click(screen.getByLabelText("Restore the default"));
    expect((screen.getByLabelText("Event tag") as HTMLInputElement).value).toBe(
      "{zkratka} {domaci}-{hoste}",
    );
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() =>
      expect(parseManifest(files.get(manifestPathFor(PGN_PATH))!)!.options.eventPattern).toBeNull(),
    );
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

  it("warns about matches with no moves and teams the directory does not know", async () => {
    seed(false);
    // A team the games spell differently from the manifest is the one case the
    // directory cannot cover: its Event would carry the full name.
    files.set(PGN_PATH, files.get(PGN_PATH)!.replaceAll('"Dubno A"', '"Dubno A — B tým"'));
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
    // Site is the home team's venue, derived from its label because the manifest
    // stores none — not the empty Site the skeleton was built with.
    expect(getTag(first.tags, "Site")).toBe("T1");
    expect(getTag(first.tags, "White")).toBe("Simak, Roman");
    expect(first.tags.order).not.toContain("WhiteTeam");
    expect(files.get(SAVE_PATH)).not.toMatch(/[ěščřžýáíé]/);
    // The database itself keeps the full format.
    expect(files.get(PGN_PATH)).toContain('[WhiteTeam "ŠK KDJS Sedlčany A"]');
  });

  it("shows the Event of a real game and the file it will write", async () => {
    seed(true);
    renderModal([...Array(48).keys()]);
    await screen.findByText("Export ŠSČR — 1. kolo");
    // Not a "PREFIX A-B" stand-in: the first game actually being exported.
    expect(screen.getByText("KSA SSS 25/26 T1-T12")).toBeTruthy();
    expect(screen.getByText("KSA-1.pgn")).toBeTruthy();
  });

  it("composes Event from a stored pattern", async () => {
    seed(true);
    const manifest = parseManifest(files.get(manifestPathFor(PGN_PATH))!)!;
    manifest.options.eventPattern = "{zkratka} {kolo} {domaci}-{hoste}";
    files.set(manifestPathFor(PGN_PATH), serializeManifest(manifest));

    renderModal([...Array(48).keys()]);
    await screen.findByText("Export ŠSČR — 1. kolo");
    fireEvent.click(screen.getByText("Export"));

    await vi.waitFor(() => expect(files.get(SAVE_PATH)).toBeTruthy());
    const first = splitGame(splitPgnGames(files.get(SAVE_PATH)!)[0]);
    expect(getTag(first.tags, "Event")).toBe("KSA SSS 25/26 01 T1-T12");
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

// ── Zkratky zápasu ──────────────────────────────────────────────────────────
// The other half of the same directory, for a match imported from ŠSČR: no
// manifest, so the pieces come out of the file's own Event and go into .info.

const MATCH_PATH = "/docs/KSA-1-Sedlcany-Kralupy.pgn";
const MATCH_INFO = "/docs/KSA-1-Sedlcany-Kralupy.info";
const MATCH_HOME = "ŠK KDJS Sedlčany A";
const MATCH_AWAY = "Klokani z Kralup";

/** Eight boards as the ŠSČR import writes them: one Event, Site "chess.cz". */
function seedMatch(event = "KSA SSS 25/26 Sedlcany A-Kralupy B") {
  const games: string[] = [];
  for (let board = 1; board <= 8; board++) {
    const homeIsWhite = board % 2 === 1;
    games.push(
      [
        `[Event "${event}"]`,
        '[Site "chess.cz"]',
        '[Date "2025.10.12"]',
        `[Round "1.${board}"]`,
        `[White "Bílý, Jan"]`,
        `[Black "Černý, Petr"]`,
        '[Result "*"]',
        `[Board "${board}"]`,
        `[WhiteTeam "${homeIsWhite ? MATCH_HOME : MATCH_AWAY}"]`,
        `[BlackTeam "${homeIsWhite ? MATCH_AWAY : MATCH_HOME}"]`,
        "",
        "*",
      ].join("\n"),
    );
  }
  files.set(MATCH_PATH, games.join("\n\n\n") + "\n");
  files.set(MATCH_INFO, JSON.stringify({ type: "tournament", tags: [] }));
}

describe("MatchLabelsDialog", () => {
  function renderDialog(onSaved = () => {}, path = MATCH_PATH) {
    return render(
      <MantineProvider>
        <MatchLabelsDialog opened onClose={() => {}} pgnPath={path} onSaved={onSaved} />
      </MantineProvider>,
    );
  }

  it("opens with the pieces the file's own Event was composed from", async () => {
    seedMatch();
    renderDialog();
    expect(await screen.findByDisplayValue("KSA SSS 25/26")).toBeTruthy();
    const home = screen.getByLabelText(`Short label — ${MATCH_HOME}`) as HTMLInputElement;
    const away = screen.getByLabelText(`Short label — ${MATCH_AWAY}`) as HTMLInputElement;
    // "Klokani z Kralup" shortens to "Klokani", but this file says "Kralupy B".
    expect(home.value).toBe("Sedlcany A");
    expect(away.value).toBe("Kralupy B");
    expect((screen.getByLabelText(`Venue (Site) — ${MATCH_HOME}`) as HTMLInputElement).value).toBe(
      "Sedlcany",
    );
    expect(screen.getByText("KSA SSS 25/26 Sedlcany A-Kralupy B")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Competition\.[A-Z]/);
  });

  it("rewrites Event and Site on every board and remembers the pieces", async () => {
    seedMatch();
    const onSaved = vi.fn();
    renderDialog(onSaved);
    await screen.findByDisplayValue("KSA SSS 25/26");

    fireEvent.change(screen.getByLabelText(`Short label — ${MATCH_AWAY}`), {
      target: { value: "Kralupy" },
    });
    fireEvent.change(screen.getByLabelText(`Venue (Site) — ${MATCH_HOME}`), {
      target: { value: "Sedlčany" },
    });
    fireEvent.click(screen.getByText("Save and rewrite Event"));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const games = splitPgnGames(files.get(MATCH_PATH)!);
    expect(games).toHaveLength(8);
    for (const game of games) {
      expect(getTag(splitGame(game).tags, "Event")).toBe("KSA SSS 25/26 Sedlcany A-Kralupy");
      expect(getTag(splitGame(game).tags, "Site")).toBe("Sedlčany");
    }
    // Player and team tags are none of this dialog's business.
    expect(getTag(splitGame(games[0]).tags, "WhiteTeam")).toBe(MATCH_HOME);

    const info = JSON.parse(files.get(MATCH_INFO)!);
    expect(info.type).toBe("tournament"); // en-croissant's own field survives
    expect(info.match).toMatchObject({ prefix: "KSA SSS 25/26", eventPattern: null });
    expect(info.match.teams).toEqual([
      { name: MATCH_HOME, label: "Sedlcany A", site: "Sedlčany" },
      { name: MATCH_AWAY, label: "Kralupy", site: "Kralupy" },
    ]);
  });

  it("reopens on what it stored, not on what the dictionary would say", async () => {
    seedMatch();
    files.set(
      MATCH_INFO,
      JSON.stringify({
        type: "tournament",
        tags: [],
        match: {
          prefix: "KSA 25/26",
          eventPattern: "{zkratka} {domaci} vs {hoste}",
          teams: [
            { name: MATCH_HOME, label: "Sedlčany", site: "Sedlčany" },
            { name: MATCH_AWAY, label: "Klokani", site: "" },
          ],
        },
      }),
    );
    renderDialog();
    expect(await screen.findByDisplayValue("KSA 25/26")).toBeTruthy();
    expect(screen.getByText("KSA 25/26 Sedlčany vs Klokani")).toBeTruthy();
  });

  it("says so when the file is not a match", async () => {
    files.set(MATCH_PATH, '[Event "Kasparov - Karpov"]\n[Result "*"]\n\n*\n');
    renderDialog();
    expect(await screen.findByText(/does not look like a match/)).toBeTruthy();
  });
});

// Zkratky zápasu — the one-match half of the team directory.
//
// A match imported from ŠSČR is an ordinary .pgn: eight games sharing one `Event`
// that was composed once, at import time, from the competition abbreviation and two
// short team labels ("KSA SSS 25/26 Sedlcany A-Kralupy B"). Nothing kept those
// pieces afterwards, so changing a single label meant retyping the tag on all eight
// boards — the competition mode's „Zkratky soutěže" had no counterpart here.
//
// The pieces live in the `.info` sidecar the file already has. A match gets no
// manifest of its own on purpose: two teams, one round, no XML source and no
// re-sync — a `*.competition.json` beside it would make en-croissant treat it as a
// competition. The `Event` is recomposed from the pieces through the same
// `namePattern` the competition export uses, so both write the same shape.
//
// Everything is derived by default and only stored once someone opens the dialog
// (the rule the competition directory settled on), so a match imported before any
// of this existed opens with sensible values instead of empty fields: the labels
// come from the bundled club dictionary, the venue from the label without the team
// letter, and the abbreviation is read back out of the `Event` the file carries.

import { z } from "zod";
import { setGameTag } from "@/utils/pgn/check";
import { buildEventFromPattern, DEFAULT_EVENT_PATTERN } from "@/utils/pgn/namePattern";
import { getTag, splitGame } from "@/utils/pgn/tags";
import { defaultSite, deriveDirectory } from "./directory";

/** `Site` the ŠSČR import stamps on every board — the source, not a venue. It is
 *  treated as "no venue set" so the dialog offers the derived one instead. */
export const IMPORT_SITE = "chess.cz";

export const matchTeamSchema = z.object({
    /** Full team name, exactly as `WhiteTeam`/`BlackTeam` spell it — the key. */
    name: z.string(),
    /** Short label for the `Event` tag; null = derive it. */
    label: z.string().nullable(),
    /** Venue for `Site`; null = derive, empty string = deliberately blank. */
    site: z.string().nullable(),
});

export const matchLabelsSchema = z.object({
    /** Competition abbreviation that opens the `Event` tag ("KSA SSS 25/26"). */
    prefix: z.string().nullable().default(null),
    /** Pattern the `Event` is composed from; null = the default. */
    eventPattern: z.string().nullable().default(null),
    teams: z.array(matchTeamSchema).default([]),
});

export type MatchLabels = z.infer<typeof matchLabelsSchema>;

export type MatchTeamEntry = { name: string; label: string; site: string };

export type ResolvedMatchLabels = {
    prefix: string;
    eventPattern: string;
    home: MatchTeamEntry;
    away: MatchTeamEntry;
    /** The `Event` the games carry today — "" when they carry none. */
    currentEvent: string;
    /** The games disagree about `Event`; applying will unify them. */
    mixedEvents: boolean;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().replace(/\s+/g, " ");

/** Board number of a game: the `Board` tag, or the last component of `Round`
 *  (`kolo.šachovnice` from the import, `kolo.zápas.šachovnice` from a competition). */
function boardOf(gameText: string): number | null {
    const { tags } = splitGame(gameText);
    for (const raw of [getTag(tags, "Board"), (getTag(tags, "Round") ?? "").split(".").pop()]) {
        const n = Number.parseInt((raw ?? "").trim(), 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

function top(counts: Map<string, number>): string {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function tally(counts: Map<string, number>, key: string): void {
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Home and away team of a match, from the team tags and the board parity that
 *  decides the colours (odd board = home plays white). Null when the games carry no
 *  team tags at all — then this is not a match file and there is nothing to label. */
export function readMatchTeams(games: string[]): { home: string; away: string } | null {
    const homes = new Map<string, number>();
    const aways = new Map<string, number>();
    for (const game of games) {
        const { tags } = splitGame(game);
        const white = norm(getTag(tags, "WhiteTeam"));
        const black = norm(getTag(tags, "BlackTeam"));
        if (!white || !black) continue;
        // No board number (a single game pulled out of context): white is the home
        // side, which is what board 1 would have said anyway.
        const homeIsWhite = (boardOf(game) ?? 1) % 2 === 1;
        tally(homes, homeIsWhite ? white : black);
        tally(aways, homeIsWhite ? black : white);
    }
    const home = top(homes);
    const away = top(aways);
    return home && away && home !== away ? { home, away } : null;
}

/** The `Event` the file agrees on, plus whether it agrees at all. */
function eventOf(games: string[]): { event: string; mixed: boolean } {
    const counts = new Map<string, number>();
    for (const game of games) tally(counts, norm(getTag(splitGame(game).tags, "Event")));
    return { event: top(counts), mixed: counts.size > 1 };
}

/** `Site` the games agree on, ignoring the import's own stamp. */
function siteOf(games: string[]): string {
    const counts = new Map<string, number>();
    for (const game of games) {
        const site = norm(getTag(splitGame(game).tags, "Site"));
        if (site && site !== IMPORT_SITE) tally(counts, site);
    }
    return top(counts);
}

// ── reading a composed Event back apart ─────────────────────────────────────
// The abbreviation and the labels only exist inside the `Event` tag of a match
// imported before this dialog did, so they have to be read back out of it — and
// "KSA SSS 25/26 Sedlcany A-Kralupy B" can be split four ways by the default
// pattern alone. Every split is enumerated and scored against the full team names
// the games carry, which is the one piece of outside knowledge that settles it: the
// half that reads "Sedlcany A" belongs to "ŠK KDJS Sedlčany A", "25/26 Sedlcany A"
// does not. Nothing is guessed when no split scores — the dialog then falls back to
// the club dictionary, and the leader sees the file's own Event beside the preview.

/** Ceiling on enumerated splits, so a pathological pattern can't hang the dialog. */
const MAX_SPLITS = 200;

function segmentsOf(pattern: string): string[] {
    return pattern.split(/(\{\w+\})/).filter((part) => part !== "");
}

/** Every reading of `text` as `pattern`, with each placeholder non-empty. */
function enumerateSplits(text: string, segments: string[]): Record<string, string>[] {
    const out: Record<string, string>[] = [];

    function walk(pos: number, i: number, acc: Record<string, string>, pending: string | null) {
        if (out.length >= MAX_SPLITS) return;
        if (i === segments.length) {
            if (pending) {
                const rest = text.slice(pos);
                if (rest) out.push({ ...acc, [pending]: rest });
            } else if (pos === text.length) {
                out.push({ ...acc });
            }
            return;
        }
        const segment = segments[i];
        if (/^\{\w+\}$/.test(segment)) {
            // Two placeholders with nothing between them can be split anywhere —
            // there is no reading to prefer, so there is no answer to give.
            if (pending) return;
            walk(pos, i + 1, acc, segment.slice(1, -1));
            return;
        }
        if (!pending) {
            if (text.startsWith(segment, pos)) walk(pos + segment.length, i + 1, acc, null);
            return;
        }
        for (let at = text.indexOf(segment, pos + 1); at >= 0; at = text.indexOf(segment, at + 1)) {
            walk(at + segment.length, i + 1, { ...acc, [pending]: text.slice(pos, at) }, null);
        }
    }

    walk(0, 0, {}, null);
    return out;
}

function words(s: string): string[] {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/** How much a candidate label looks like a shortening of a full team name: every
 *  word that survives into the label scores, every invented one costs. */
function similarity(label: string, teamName: string): number {
    const want = words(teamName);
    const got = words(label);
    if (got.length === 0) return -Infinity;
    let score = 0;
    for (const word of got) {
        const hit = want.some(
            (w) => w === word || (word.length >= 3 && (w.startsWith(word) || word.startsWith(w))),
        );
        score += hit ? 1 : -1;
    }
    return score;
}

export type EventParts = { prefix: string; homeLabel: string; awayLabel: string };

/** The pieces an `Event` was composed from, or null when it doesn't read as this
 *  pattern at all (a hand-written Event, or the full competition name the import
 *  falls back to when chess.cz is unreachable). `hints` are labels known to be
 *  plausible — a stored or freshly derived one — and settle ties outright. */
export function decomposeEvent(
    event: string,
    pattern: string | null | undefined,
    teams: { home: string; away: string },
    hints?: { home: string[]; away: string[] },
): EventParts | null {
    const text = norm(event);
    if (!text) return null;
    const segments = segmentsOf(((pattern ?? "").trim() || DEFAULT_EVENT_PATTERN).trim());
    const hintScore = (label: string, list: string[] | undefined) =>
        (list ?? []).some((h) => norm(h) && norm(h) === label) ? 10 : 0;

    let best: { parts: EventParts; score: number } | null = null;
    for (const split of enumerateSplits(text, segments)) {
        const homeLabel = norm(split.domaci);
        const awayLabel = norm(split.hoste);
        if (!homeLabel || !awayLabel) continue;
        const score =
            similarity(homeLabel, teams.home) +
            similarity(awayLabel, teams.away) +
            hintScore(homeLabel, hints?.home) +
            hintScore(awayLabel, hints?.away);
        if (score > 0 && (!best || score > best.score)) {
            best = { parts: { prefix: norm(split.zkratka ?? ""), homeLabel, awayLabel }, score };
        }
    }
    return best?.parts ?? null;
}

/** Everything the dialog needs about a match file: the two teams with a label and a
 *  venue each, the abbreviation, and the pattern. Stored values win; the rest is
 *  derived. Null when the file is not a match. */
export function resolveMatchLabels(
    games: string[],
    stored: MatchLabels | null,
): ResolvedMatchLabels | null {
    const teams = readMatchTeams(games);
    if (!teams) return null;

    const derived = deriveDirectory([
        { no: 1, name: teams.home },
        { no: 2, name: teams.away },
    ]);
    const storedBy = new Map((stored?.teams ?? []).map((team) => [team.name, team]));
    const fileSite = siteOf(games);
    const eventPattern = stored?.eventPattern ?? DEFAULT_EVENT_PATTERN;
    const { event, mixed } = eventOf(games);
    // What the file's own Event says, when it can be read apart. It outranks the
    // dictionary: the point of the dialog is to edit the labels this file actually
    // uses, not the ones a two-team shortening happens to produce today (the import
    // shortened across all twelve teams of the competition, which is why they can
    // differ at all).
    const inFile = decomposeEvent(event, eventPattern, teams, {
        home: [storedBy.get(teams.home)?.label ?? "", derived.get(1)?.label ?? ""],
        away: [storedBy.get(teams.away)?.label ?? "", derived.get(2)?.label ?? ""],
    });

    function entry(no: number, name: string): MatchTeamEntry {
        const kept = storedBy.get(name);
        const fromEvent = no === 1 ? inFile?.homeLabel : inFile?.awayLabel;
        const label = kept?.label?.trim() || fromEvent || derived.get(no)?.label || name;
        // A venue already in the file beats the derived one — it may have been set
        // by hand or by a competition export — but the import's "chess.cz" is not a
        // venue and never counts.
        const site = kept?.site ?? (no === 1 ? fileSite || defaultSite(label) : defaultSite(label));
        return { name, label, site };
    }

    const home = entry(1, teams.home);
    const away = entry(2, teams.away);
    const prefix = stored?.prefix ?? inFile?.prefix ?? "";

    return { prefix, eventPattern, home, away, currentEvent: event, mixedEvents: mixed };
}

export type MatchLabelsInput = {
    prefix: string;
    eventPattern: string;
    home: MatchTeamEntry;
    away: MatchTeamEntry;
};

/** The `Event` these pieces compose — the same call the competition export makes. */
export function matchEvent(input: MatchLabelsInput): string {
    return buildEventFromPattern(input.eventPattern, {
        zkratka: input.prefix,
        domaci: input.home.label,
        hoste: input.away.label,
    });
}

/** Write the composed `Event` onto every game, and the home team's venue into
 *  `Site` — one match is played in one hall. An empty venue leaves `Site` alone
 *  rather than blanking it: "I have no venue for this team" is not a request to
 *  drop whatever the file already says. */
export function applyMatchLabels(games: string[], input: MatchLabelsInput): string[] {
    const event = matchEvent(input);
    const site = input.home.site.trim();
    return games.map((game) => {
        const withEvent = setGameTag(game, "Event", event);
        return site ? setGameTag(withEvent, "Site", site) : withEvent;
    });
}

/** What the `.info` sidecar keeps. The composed `Event` lives in the games; this is
 *  only what could not be read back out of them unambiguously. */
export function toStoredMatchLabels(input: MatchLabelsInput): MatchLabels {
    return {
        prefix: input.prefix.trim() || null,
        eventPattern:
            input.eventPattern.trim() === "" || input.eventPattern.trim() === DEFAULT_EVENT_PATTERN
                ? null
                : input.eventPattern.trim(),
        teams: [input.home, input.away].map((team) => ({
            name: team.name,
            label: team.label.trim() || null,
            site: team.site.trim(),
        })),
    };
}

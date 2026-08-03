// The ŠSČR export profile.
//
// Storage is the full format (diacritics, team tags, ids, three-level Round). What
// the competition website wants is narrower, and the shape was taken verbatim from
// a bulletin a competition leader published:
//
//   [Event "KSA SSS 25/26 Sedlcany-Kralupy B"]   prefix + short team names, no diacritics
//   [Date "2025.10.12"]
//   [Round "1.1"]                                 kolo.šachovnice — the match is in Event
//   [White "Simak, Roman"] [Black "Hanl, Frantisek"] [Result "1/2-1/2"]
//   [ECO "B36"] [WhiteElo "1896"] [BlackElo "2158"] [PlyCount "73"]
//
// Nothing here mutates the database; it is a projection, computed at export time.

import { removeDiacritics } from "@/utils/pgn/cleanup";
import { getTag, type PgnTags, serializeGame, splitGame } from "@/utils/pgn/tags";
import { compAbbr, seasonAbbr } from "@/utils/chesscz/teamShorten";
import type { CompetitionManifest } from "./manifest";
import { parseRoundTag } from "./skeleton";
import { hasMoves, isUninformative } from "./sync";

/** Tag set and order of the ŠSČR profile, matching the reference bulletin. */
export const SSCR_TAGS = [
    "Event",
    "Date",
    "Round",
    "White",
    "Black",
    "Result",
    "ECO",
    "WhiteElo",
    "BlackElo",
    "PlyCount",
];

export type SscrExportOptions = {
    /** Competition abbreviation that opens every Event ("KSA SSS 25/26"). */
    prefix: string;
    /** Full team name → short label. Unknown names fall through unchanged. */
    labelByTeamName: Map<string, string>;
    /** Drop forfeited boards nobody played — Swiss-Manager's own export and the
     *  reference bulletin both omit them. */
    dropEmptyForfeits: boolean;
    stripDiacritics: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: Omit<SscrExportOptions, "prefix" | "labelByTeamName"> = {
    dropEmptyForfeits: true,
    stripDiacritics: true,
};

/** Suggested Event prefix when the leader has not set one: the competition-name
 *  abbreviation plus the season ("KS A 25/26"). Always editable — the leader knows
 *  their own convention, and the XML carries no region code to do better. */
export function defaultEventPrefix(compName: string, year: number | null): string {
    const [abbr] = compAbbr(compName);
    const season = year != null ? seasonAbbr(year) : "";
    return [abbr, season].filter(Boolean).join(" ").trim();
}

/** Name → label map from the manifest, with the leader's overrides winning. */
export function labelMapFrom(manifest: CompetitionManifest): Map<string, string> {
    const out = new Map<string, string>();
    for (const team of manifest.teams) {
        if (team.label) out.set(team.name, team.label);
    }
    return out;
}

/** "<prefix> <home>-<away>", diacritics stripped like the rest of the profile. */
export function buildSscrEvent(prefix: string, home: string, away: string): string {
    return `${prefix} ${home}-${away}`.trim().replace(/\s+/g, " ");
}

export type ExportedGame = {
    /** The full-format `Round` tag this came from ("1.1.1"). */
    sourceRound: string;
    text: string;
};

type GameFacts = {
    tags: PgnTags;
    movetext: string;
    roundNr: number;
    boardNr: number;
    homeTeam: string;
    awayTeam: string;
    forfeit: boolean;
    /** A forfeit where at least one side has no player — what gets dropped. */
    emptyForfeit: boolean;
};

/** Everything the profile needs from one stored game; null when the game is not a
 *  competition game (no three-level Round), which the export leaves alone. */
export function readGameFacts(gameText: string): GameFacts | null {
    const { tags, movetext } = splitGame(gameText);
    const key = parseRoundTag(getTag(tags, "Round"));
    if (!key) return null;
    const homeIsWhite = key.boardNr % 2 === 1;
    const white = getTag(tags, "White") ?? "";
    const black = getTag(tags, "Black") ?? "";
    const whiteTeam = getTag(tags, "WhiteTeam") ?? "";
    const blackTeam = getTag(tags, "BlackTeam") ?? "";
    const forfeit = (getTag(tags, "Termination") ?? "") === "forfeit";
    return {
        tags,
        movetext,
        roundNr: key.roundNr,
        boardNr: key.boardNr,
        homeTeam: homeIsWhite ? whiteTeam : blackTeam,
        awayTeam: homeIsWhite ? blackTeam : whiteTeam,
        forfeit,
        emptyForfeit: forfeit && (isUninformative(white) || isUninformative(black)),
    };
}

function label(name: string, map: Map<string, string>): string {
    return map.get(name) ?? name;
}

/** Project one stored game into the ŠSČR profile. Returns null when the game is
 *  dropped (an unplayed forfeit) or is not a competition game at all. */
export function toSscrGame(gameText: string, opts: SscrExportOptions): ExportedGame | null {
    const facts = readGameFacts(gameText);
    if (!facts) return null;
    if (opts.dropEmptyForfeits && facts.emptyForfeit) return null;

    const event = buildSscrEvent(
        opts.prefix,
        label(facts.homeTeam, opts.labelByTeamName),
        label(facts.awayTeam, opts.labelByTeamName),
    );

    const order: string[] = [];
    const map: Record<string, string> = {};
    for (const tag of SSCR_TAGS) {
        const value =
            tag === "Event"
                ? event
                : tag === "Round"
                  ? `${facts.roundNr}.${facts.boardNr}`
                  : (getTag(facts.tags, tag) ?? "");
        // Only the Seven Tag Roster is mandatory; the rest is skipped when empty,
        // exactly as the reference bulletin does.
        if (value === "" && !["Event", "Date", "Round", "White", "Black", "Result"].includes(tag)) {
            continue;
        }
        order.push(tag);
        map[tag] = value || (tag === "Result" ? "*" : "?");
    }

    const text = serializeGame({ order, map }, facts.movetext.trim() || (map.Result ?? "*"));
    return {
        sourceRound: `${facts.roundNr}.${getTag(facts.tags, "Round")?.split(".")[1] ?? "?"}.${facts.boardNr}`,
        text: opts.stripDiacritics ? removeDiacritics(text) : text,
    };
}

export type SscrExportResult = {
    pgn: string;
    included: number;
    dropped: number;
};

/** Project a whole scope into one ŠSČR PGN. */
export function buildSscrExport(games: string[], opts: SscrExportOptions): SscrExportResult {
    const out: string[] = [];
    let dropped = 0;
    for (const game of games) {
        const projected = toSscrGame(game, opts);
        if (projected) out.push(projected.text);
        else dropped++;
    }
    return {
        pgn: out.join("\n\n\n") + (out.length > 0 ? "\n" : ""),
        included: out.length,
        dropped,
    };
}

// ── preflight ───────────────────────────────────────────────────────────────
// The export is a deliverable, not a view: a missing match shows up in the
// bulletin as eight empty games and nobody notices. So say what is missing first.

export type ExportPreflight = {
    total: number;
    withoutMoves: number;
    withoutResult: number;
    placeholderNames: number;
    droppedForfeits: number;
    /** Matches (kolo.zápas) where not a single game has moves. */
    matchesWithoutMoves: string[];
    /** Two different matches that would carry the same Event tag. */
    duplicateEvents: string[];
    /** Team names with no short label — the Event would carry the full name. */
    unlabelledTeams: string[];
    /** Nothing above is a blocker, but this says whether anything is worth a look. */
    clean: boolean;
};

export function exportPreflight(games: string[], opts: SscrExportOptions): ExportPreflight {
    const byMatch = new Map<string, { moves: number; event: string }>();
    const unlabelled = new Set<string>();
    let total = 0;
    let withoutMoves = 0;
    let withoutResult = 0;
    let placeholderNames = 0;
    let droppedForfeits = 0;

    for (const game of games) {
        const facts = readGameFacts(game);
        if (!facts) continue;
        if (opts.dropEmptyForfeits && facts.emptyForfeit) {
            droppedForfeits++;
            continue;
        }
        total++;

        const moves = hasMoves(facts.movetext);
        if (!moves) withoutMoves++;
        const result = getTag(facts.tags, "Result") ?? "";
        if (result === "" || result === "*") withoutResult++;
        if (
            isUninformative(getTag(facts.tags, "White")) ||
            isUninformative(getTag(facts.tags, "Black"))
        ) {
            placeholderNames++;
        }
        for (const name of [facts.homeTeam, facts.awayTeam]) {
            if (name && !opts.labelByTeamName.has(name)) unlabelled.add(name);
        }

        const matchId = `${facts.roundNr}.${getTag(facts.tags, "Round")?.split(".")[1] ?? "?"}`;
        const event = buildSscrEvent(
            opts.prefix,
            label(facts.homeTeam, opts.labelByTeamName),
            label(facts.awayTeam, opts.labelByTeamName),
        );
        const entry = byMatch.get(matchId);
        if (entry) entry.moves += moves ? 1 : 0;
        else byMatch.set(matchId, { moves: moves ? 1 : 0, event });
    }

    const matchesWithoutMoves = [...byMatch.entries()]
        .filter(([, v]) => v.moves === 0)
        .map(([k]) => k);

    const eventOwners = new Map<string, Set<string>>();
    for (const [matchId, v] of byMatch) {
        const owners = eventOwners.get(v.event);
        if (owners) owners.add(matchId);
        else eventOwners.set(v.event, new Set([matchId]));
    }
    const duplicateEvents = [...eventOwners.entries()]
        .filter(([, owners]) => owners.size > 1)
        .map(([event]) => event);

    const unlabelledTeams = [...unlabelled].sort();
    return {
        total,
        withoutMoves,
        withoutResult,
        placeholderNames,
        droppedForfeits,
        matchesWithoutMoves,
        duplicateEvents,
        unlabelledTeams,
        clean:
            withoutMoves === 0 &&
            withoutResult === 0 &&
            placeholderNames === 0 &&
            duplicateEvents.length === 0 &&
            unlabelledTeams.length === 0,
    };
}

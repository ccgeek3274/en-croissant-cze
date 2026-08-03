// Short, competition-unique team labels + the Event-tag prefix for a whole
// competition. This is the offline, no-backend equivalent of pgn-base's
// `computeCompetitionLabels` (backend/src/routes/chesscz.ts): the reference data it
// reads from D1 is instead bundled as JSON and indexed in-process. The gazetteer tier
// is intentionally dropped (see MAINTAINING.md) — every registered ŠSČR club is already
// in the mined dictionary, so `dict → heuristic` covers real league teams.
import {
    getCompetitionDetails,
    getCompetitions,
    getCompetitionSchedule,
    getCompetitionTable,
} from "./client";
import clubLabelDict from "./data/club_label_dict.json";
import compAbbrOverrides from "./data/comp_abbr_overrides.json";
import labelOverrides from "./data/label_overrides.json";
import {
    buildDictIndex,
    buildGazIndex,
    type DictRow,
    eventPrefix,
    norm,
    resolveCompetition,
    type ShortenData,
    type TeamInput,
} from "./teamShorten";

export type CompetitionLabels = {
    // Event-tag prefix ("KP StC 24/25"), or null when it can't be derived — the caller
    // then falls back to the full competition name.
    prefix: string | null;
    // Authoritative competition name (from the catalog or /details); "" if unresolved.
    compName: string;
    labelByTeamId: Map<number, string>;
};

type DictJsonRow = { clubId?: number; clubName: string; label?: string };
type OverrideJsonRow = { clubName: string; label: string };
type CompOverrideJsonRow = { compId: number; prefix: string };

// ── Reference data, indexed once ────────────────────────────────────────────
let shortenData: ShortenData | null = null;
function getShortenData(): ShortenData {
    if (shortenData) return shortenData;
    const dict: DictRow[] = (clubLabelDict as DictJsonRow[])
        .filter((r) => r.label)
        .map((r) => ({ label: r.label as string, clubName: r.clubName, clubId: r.clubId ?? null }));
    const overrides = new Map<string, string>();
    for (const r of labelOverrides as OverrideJsonRow[]) overrides.set(norm(r.clubName), r.label);
    // Lean data set: no gazetteer tier (empty index → falls through to the heuristic).
    shortenData = { dict: buildDictIndex(dict), gaz: buildGazIndex([]), overrides };
    return shortenData;
}

let compPrefixOverrides: Map<number, string> | null = null;
function getCompPrefixOverrides(): Map<number, string> {
    if (compPrefixOverrides) return compPrefixOverrides;
    compPrefixOverrides = new Map();
    for (const r of compAbbrOverrides as CompOverrideJsonRow[]) {
        compPrefixOverrides.set(Number(r.compId), r.prefix);
    }
    return compPrefixOverrides;
}

// ── Competition meta (name / region / season) for the prefix ────────────────
type CompMeta = { regionCode: string; compName: string; compSeason: number };

function parseCzDateYM(s: string | undefined): { y: number; m: number } | null {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((s ?? "").trim());
    return m ? { y: Number(m[3]), m: Number(m[2]) } : null;
}

/** Season year from the earliest round date. A season spans autumn→spring, so a round
 * in Jul–Dec of year Y belongs to season Y (= Y/Y+1); Jan–Jun ⇒ Y-1. */
async function seasonFromSchedule(compId: number): Promise<number | null> {
    const schedule = await getCompetitionSchedule(compId).catch(() => []);
    let best: { y: number; m: number } | null = null;
    for (const r of schedule) {
        const d = parseCzDateYM(r.roundDate);
        if (d && (!best || d.y < best.y || (d.y === best.y && d.m < best.m))) best = d;
    }
    return best ? (best.m >= 7 ? best.y : best.y - 1) : null;
}

async function resolveCompMeta(compId: number): Promise<CompMeta | null> {
    // The aggregate catalog only lists the current season; try it first, then fall back
    // to per-competition /details (+ season derived from the schedule).
    try {
        const byRegion = await getCompetitions();
        for (const region of Object.values(byRegion)) {
            for (const c of region.competitions ?? []) {
                if (Number(c.compId) !== compId) continue;
                const season = Number(c.compSeason);
                if (Number.isFinite(season)) {
                    return {
                        regionCode: region.regionCode,
                        compName: c.compName,
                        compSeason: season,
                    };
                }
            }
        }
    } catch {
        // Ignore — fall through to /details below.
    }

    const det = await getCompetitionDetails(compId).catch(() => null);
    const compName = det?.compName?.trim();
    const regionCode = /\(([^)]+)\)\s*$/.exec(det?.regionName ?? "")?.[1]?.trim() ?? "";
    if (!compName || !regionCode) return null;
    const compSeason = await seasonFromSchedule(compId);
    return compSeason == null ? null : { regionCode, compName, compSeason };
}

// ── Public entry point ──────────────────────────────────────────────────────

/** Resolve the Event prefix + per-team short labels for a competition. Best-effort:
 * on any failure it degrades to a null prefix and empty label map, so the caller keeps
 * working with the full competition/team names. */
export async function computeCompetitionLabels(compId: number): Promise<CompetitionLabels> {
    const [teams, meta] = await Promise.all([
        getCompetitionTable(compId).catch(() => [] as TeamInput[]),
        resolveCompMeta(compId).catch(() => null),
    ]);
    const compName = meta?.compName ?? "";

    // No team set → nothing to shorten; leave the caller on full names (matches pgn-base).
    if (teams.length === 0) return { prefix: null, compName, labelByTeamId: new Map() };

    const resolved = resolveCompetition(teams, getShortenData());
    const labelByTeamId = new Map<number, string>();
    for (const t of resolved) labelByTeamId.set(t.teamId, t.label);

    let prefix: string | null = null;
    const override = getCompPrefixOverrides().get(compId);
    if (override) prefix = override;
    else if (meta) prefix = eventPrefix(meta.compName, meta.regionCode, meta.compSeason).prefix;

    return { prefix, compName, labelByTeamId };
}

/** Short labels for a team list we already have in hand — no API call, no compId.
 * This is the path the XML-driven competition mode uses: the roster comes out of
 * the Swiss-Manager file, so only the bundled dictionary is needed. */
export function shortenTeamNames(teams: TeamInput[]): Map<number, string> {
    const out = new Map<number, string>();
    if (teams.length === 0) return out;
    for (const t of resolveCompetition(teams, getShortenData())) out.set(t.teamId, t.label);
    return out;
}

/** Compose the Event tag for one match: "<prefix> <home>-<away>", or the full
 * competition name when no prefix/labels are available. */
export function composeEventName(
    labels: CompetitionLabels | null,
    homeTeamId: number,
    homeTeamName: string,
    awayTeamId: number,
    awayTeamName: string,
    fallbackCompName: string,
): string {
    if (!labels?.prefix) return fallbackCompName;
    const home = labels.labelByTeamId.get(homeTeamId) ?? homeTeamName;
    const away = labels.labelByTeamId.get(awayTeamId) ?? awayTeamName;
    return `${labels.prefix} ${home}-${away}`;
}

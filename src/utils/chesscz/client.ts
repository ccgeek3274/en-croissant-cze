// Direct client for the public api.chess.cz (ŠSČR) REST API.
//
// en-croissant is a desktop app with no backend, so the throttling + caching that
// pgn-base does server-side (Cloudflare D1) lives here in-process instead:
//   - a ~1 req/s politeness floor (api.chess.cz tolerates ~1 req/s; bursts get the
//     IP blocked), implemented as a serial queue,
//   - an in-memory TTL cache + in-flight de-duplication,
//   - stale-on-error: a previously cached value is served if a refresh fails.
import { fetch } from "@tauri-apps/plugin-http";
import { apiHeaders } from "@/utils/http";
import {
    asArray,
    type ChessczCompetitionDetails,
    type ChessczCompetitionsByRegion,
    type ChessczMatchResult,
    type ChessczMember,
    type ChessczRoundSchedule,
    type ChessczTeamRow,
    normalizePairing,
    unwrapData,
} from "./pgn";

const BASE = "https://api.chess.cz/api";
const MIN_GAP_MS = 1000;
const TIMEOUT_MS = 10_000;

export const MIN_QUERY_LEN = 3;

export const TTL = {
    search: 24 * 3600_000,
    competitions: 12 * 3600_000,
    schedule: 24 * 3600_000,
    matches: 10 * 60_000,
} as const;

export class ChessczError extends Error {
    constructor(public status: number) {
        super(`api.chess.cz returned ${status}`);
        this.name = "ChessczError";
    }
}

// ── Serial queue: at most one request at a time, ≥ MIN_GAP_MS between requests ──
let lastFetch = 0;
let queue: Promise<unknown> = Promise.resolve();

async function rawFetch(path: string): Promise<unknown> {
    const run = queue.then(async () => {
        const wait = lastFetch + MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastFetch = Date.now();
        const res = await fetch(`${BASE}${path}`, {
            method: "GET",
            headers: apiHeaders(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new ChessczError(res.status);
        return res.json();
    });
    // Keep the queue alive even if this request rejects.
    queue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

// ── TTL cache + in-flight de-dup ────────────────────────────────────────────
type CacheEntry = { at: number; ttl: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(path: string, ttl: number): Promise<T> {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.value as T;

    const existing = inflight.get(path);
    if (existing) return existing as Promise<T>;

    const p = rawFetch(path)
        .then((value) => {
            cache.set(path, { at: Date.now(), ttl, value });
            inflight.delete(path);
            return value;
        })
        .catch((err) => {
            inflight.delete(path);
            if (cached) return cached.value; // stale-on-error
            throw err;
        });
    inflight.set(path, p);
    return p as Promise<T>;
}

// ── Endpoints ───────────────────────────────────────────────────────────────
export async function searchMembers(query: string): Promise<ChessczMember[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) return [];
    const data = await get<ChessczMember | ChessczMember[]>(
        `/members/name?search=${encodeURIComponent(q)}`,
        TTL.search,
    );
    return asArray(data);
}

export async function getCompetitions(year?: number): Promise<ChessczCompetitionsByRegion> {
    const path = year ? `/competitions/${year}` : "/competitions";
    return get<ChessczCompetitionsByRegion>(path, TTL.competitions);
}

export async function getCompetitionSchedule(compId: number): Promise<ChessczRoundSchedule[]> {
    const data = await get<ChessczRoundSchedule | ChessczRoundSchedule[]>(
        `/competitions/${compId}/schedule`,
        TTL.schedule,
    );
    return asArray(data).map((r) => ({
        ...r,
        roundMatches: asArray(r.roundMatches).map(normalizePairing),
    }));
}

export async function getRoundMatches(
    compId: number,
    round: number,
): Promise<ChessczMatchResult[]> {
    const data = await get<ChessczMatchResult | ChessczMatchResult[]>(
        `/competitions/${compId}/round/${round}/matches`,
        TTL.matches,
    );
    return asArray(data).map((m) => ({ ...m, matchGames: asArray(m.matchGames) }));
}

// Competition metadata (name + region) — used to build the Event-tag prefix for a
// competition that isn't in the current-season catalog (past seasons, direct compId).
export async function getCompetitionDetails(compId: number): Promise<ChessczCompetitionDetails> {
    const data = await get<unknown>(`/competitions/${compId}/details`, TTL.competitions);
    return (unwrapData(data) ?? {}) as ChessczCompetitionDetails;
}

// Full team set of a competition — the closed set the team-label resolver needs to
// guarantee unique short labels (a single round only exposes the two paired teams).
export async function getCompetitionTable(compId: number): Promise<ChessczTeamRow[]> {
    const data = await get<unknown>(`/competitions/${compId}/table`, TTL.schedule);
    const rows = asArray(unwrapData(data)) as Array<{
        teamId?: number | string;
        teamName?: string;
    }>;
    return rows
        .map((t) => ({ teamId: Number(t.teamId), teamName: String(t.teamName ?? "") }))
        .filter((t) => Number.isFinite(t.teamId) && t.teamId > 0 && t.teamName !== "");
}

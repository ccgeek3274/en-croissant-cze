// Parser for the competition XML that Swiss-Manager keeps in its own directory
// (`<chess><tournament name="basic">`).
//
// This dialect is **undocumented** — the published Swiss-Manager XML-Import spec
// describes a different, attribute-based schema (`<Teams>`, `<Players>`, …). The
// structure below was reverse-engineered from real data and verified field by
// field against the PGN Swiss-Manager exported from the same tournament; see
// docs/feat-vedouci-souteze.md for the mapping table and the verification counts.
//
// The parser is deliberately tolerant: anything it cannot make sense of becomes an
// issue in the report rather than an exception, because a competition leader must
// be able to see *what* is wrong with a mid-season file, not just that it failed.

export type CompetitionInfo = {
    /** Swiss-Manager's internal tournament id — local to that install, not a ŠSČR compId. */
    xmlId: string;
    name: string;
    teamCount: number;
    /** `<players>` is the number of **boards per match**, not a player count. */
    boardCount: number;
    /** First year of the season (2025 = 2025/26), or null when unparseable. */
    year: number | null;
    www: string;
};

export type CompetitionTeam = {
    no: number;
    name: string;
};

export type RosterEntry = {
    teamNo: number;
    /** Position on the team's roster (1…N, contiguous). Referenced by `pde1`/`pde2`. */
    desk: number;
    /** ŠSČR player id (`<code>`). */
    czeId: string;
    /** Raw "Surname Given" as written in the XML. */
    rawName: string;
    /** National (ČR) rating — a snapshot taken when the roster was filed. */
    czeElo: number | null;
    /** FIDE rating — likewise a season-start snapshot. */
    fideElo: number | null;
    /** Roster flags: Z (základ), H (hostování), K (kapitán), … comma-separated. */
    memo: string;
};

export type BoardScore = {
    /** Raw score text as written (`"1"`, `"0"`, `"0.5"`, `"1F"`). */
    raw: string;
    /** Numeric value with any forfeit marker stripped. */
    value: number;
    forfeit: boolean;
};

export type XmlBoard = {
    boardNr: number;
    /** Roster `desk` of the fielded player; 0 = nobody was fielded. */
    homeDesk: number;
    awayDesk: number;
    home: BoardScore;
    away: BoardScore;
    /** `sct1`/`sct2` — the result for rating purposes, set only when the game was
     *  actually played but the point is awarded by forfeit. Null when absent. */
    homeRated: BoardScore | null;
    awayRated: BoardScore | null;
};

export type XmlMatch = {
    roundNr: number;
    /** 1-based position of the pairing inside the round's `schedule` string. */
    matchNr: number;
    /** The verbatim 4-character schedule token; the join key of `<game>` rows. */
    rid: string;
    homeTeamNo: number;
    awayTeamNo: number;
    /** Match score from `<results>`; null when the round carries no result row. */
    homeScore: number | null;
    awayScore: number | null;
    boards: XmlBoard[];
};

export type XmlRound = {
    roundNr: number;
    /** ISO `YYYY-MM-DD` exactly as written in `<term>`. */
    date: string;
    matches: XmlMatch[];
};

export type Competition = {
    info: CompetitionInfo;
    teams: CompetitionTeam[];
    roster: RosterEntry[];
    rounds: XmlRound[];
};

export type IssueLevel = "error" | "warn" | "info";

export type ParseIssue = {
    level: IssueLevel;
    /** Stable machine code; the UI maps it to a translated message. */
    code: string;
    /** Human-readable detail (names, numbers) to show next to the translated code. */
    detail: string;
};

export type ParseResult = {
    /** Null only when the file could not be read as this XML dialect at all. */
    competition: Competition | null;
    issues: ParseIssue[];
};

// ── small helpers ───────────────────────────────────────────────────────────

function text(parent: Element, tag: string): string {
    return (parent.getElementsByTagName(tag)[0]?.textContent ?? "").trim();
}

function num(parent: Element, tag: string): number | null {
    const raw = text(parent, tag);
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function intOr(parent: Element, tag: string, fallback: number): number {
    const n = num(parent, tag);
    return n == null ? fallback : Math.trunc(n);
}

function parseScore(raw: string): BoardScore {
    const trimmed = raw.trim();
    const forfeit = /f/i.test(trimmed);
    const value = Number(trimmed.replace(/f/gi, ""));
    return { raw: trimmed, value: Number.isFinite(value) ? value : 0, forfeit };
}

/** `schedule` is fixed-width: 4 chars per match, `%2d` home + `%2d` away.
 *  `" 112 211 310"` → `[[1,12],[2,11],[3,10]]`, keeping each raw token. */
export function parseSchedule(schedule: string): { rid: string; home: number; away: number }[] {
    const out: { rid: string; home: number; away: number }[] = [];
    for (let i = 0; i + 4 <= schedule.length; i += 4) {
        const rid = schedule.slice(i, i + 4);
        const home = Number.parseInt(rid.slice(0, 2), 10);
        const away = Number.parseInt(rid.slice(2, 4), 10);
        if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
        out.push({ rid, home, away });
    }
    return out;
}

/** `(teamNo, desk)` key for roster lookups. */
export function rosterKey(teamNo: number, desk: number): string {
    return `${teamNo}/${desk}`;
}

/** Index a roster for O(1) `(teamNo, desk)` lookup. */
export function indexRoster(roster: RosterEntry[]): Map<string, RosterEntry> {
    const map = new Map<string, RosterEntry>();
    for (const r of roster) map.set(rosterKey(r.teamNo, r.desk), r);
    return map;
}

// ── parser ──────────────────────────────────────────────────────────────────

export function parseCompetitionXml(xml: string): ParseResult {
    const issues: ParseIssue[] = [];
    const fail = (code: string, detail = ""): ParseResult => {
        issues.push({ level: "error", code, detail });
        return { competition: null, issues };
    };

    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xml, "application/xml");
    } catch (e) {
        return fail("XmlUnreadable", String(e));
    }
    if (doc.getElementsByTagName("parsererror").length > 0) {
        return fail("XmlUnreadable", doc.getElementsByTagName("parsererror")[0].textContent ?? "");
    }

    const tournament = doc.getElementsByTagName("tournament")[0];
    if (!tournament) return fail("NotACompetitionXml");

    const infoEl = tournament.getElementsByTagName("info")[0];
    if (!infoEl) return fail("MissingInfo");

    const info: CompetitionInfo = {
        xmlId: text(infoEl, "id"),
        name: text(infoEl, "name"),
        teamCount: intOr(infoEl, "teams", 0),
        boardCount: intOr(infoEl, "players", 0),
        year: num(infoEl, "year"),
        www: text(infoEl, "www"),
    };
    if (info.name === "") issues.push({ level: "warn", code: "MissingCompName", detail: "" });
    if (info.boardCount <= 0) return fail("MissingBoardCount", String(info.boardCount));

    // ── teams ────────────────────────────────────────────────────────────────
    const teams: CompetitionTeam[] = [];
    const seenTeamNo = new Set<number>();
    for (const el of Array.from(tournament.getElementsByTagName("team"))) {
        const no = intOr(el, "no", 0);
        const name = text(el, "name");
        if (no <= 0) {
            issues.push({ level: "warn", code: "TeamWithoutNumber", detail: name });
            continue;
        }
        if (seenTeamNo.has(no)) {
            issues.push({ level: "warn", code: "DuplicateTeamNumber", detail: `${no} — ${name}` });
            continue;
        }
        seenTeamNo.add(no);
        teams.push({ no, name });
    }
    if (teams.length === 0) return fail("NoTeams");
    if (info.teamCount > 0 && teams.length !== info.teamCount) {
        issues.push({
            level: "warn",
            code: "TeamCountMismatch",
            detail: `<teams>=${info.teamCount}, nalezeno ${teams.length}`,
        });
    }

    // ── roster ───────────────────────────────────────────────────────────────
    const roster: RosterEntry[] = [];
    const seenRoster = new Set<string>();
    for (const el of Array.from(tournament.getElementsByTagName("list"))) {
        const teamNo = intOr(el, "tno", 0);
        const desk = intOr(el, "desk", 0);
        const rawName = text(el, "name");
        if (teamNo <= 0 || desk <= 0) {
            issues.push({ level: "warn", code: "RosterRowWithoutKey", detail: rawName });
            continue;
        }
        const key = rosterKey(teamNo, desk);
        if (seenRoster.has(key)) {
            issues.push({
                level: "warn",
                code: "DuplicateRosterSlot",
                detail: `${key} — ${rawName}`,
            });
            continue;
        }
        if (!seenTeamNo.has(teamNo)) {
            issues.push({
                level: "warn",
                code: "RosterUnknownTeam",
                detail: `${key} — ${rawName}`,
            });
        }
        seenRoster.add(key);
        roster.push({
            teamNo,
            desk,
            czeId: text(el, "code"),
            rawName,
            czeElo: num(el, "cr"),
            fideElo: num(el, "fide"),
            memo: text(el, "memo"),
        });
    }

    // ── games, grouped by (round, rid) in document order ──────────────────────
    // Document order inside a group **is** the board order — there is no board
    // number in the XML.
    const gamesByKey = new Map<string, Element[]>();
    for (const el of Array.from(tournament.getElementsByTagName("game"))) {
        const roundNr = intOr(el, "no", 0);
        const rid = el.getElementsByTagName("rid")[0]?.textContent ?? "";
        const key = `${roundNr}|${rid}`;
        const bucket = gamesByKey.get(key);
        if (bucket) bucket.push(el);
        else gamesByKey.set(key, [el]);
    }

    // ── match results, keyed by (round, home, away) ──────────────────────────
    const resultByKey = new Map<string, { home: number | null; away: number | null }>();
    for (const el of Array.from(tournament.getElementsByTagName("results"))) {
        const roundNr = intOr(el, "no", 0);
        const home = intOr(el, "tno1", 0);
        const away = intOr(el, "tno2", 0);
        resultByKey.set(`${roundNr}|${home}|${away}`, {
            home: num(el, "scr1"),
            away: num(el, "scr2"),
        });
    }

    // ── rounds ───────────────────────────────────────────────────────────────
    const rounds: XmlRound[] = [];
    for (const el of Array.from(tournament.getElementsByTagName("round"))) {
        const roundNr = intOr(el, "no", 0);
        const date = text(el, "term");
        const schedule = el.getElementsByTagName("schedule")[0]?.textContent ?? "";
        if (roundNr <= 0) {
            issues.push({ level: "warn", code: "RoundWithoutNumber", detail: schedule });
            continue;
        }
        if (schedule.length % 4 !== 0) {
            issues.push({
                level: "warn",
                code: "ScheduleLengthOdd",
                detail: `kolo ${roundNr}: ${schedule.length} znaků`,
            });
        }

        const matches: XmlMatch[] = [];
        parseSchedule(schedule).forEach((pairing, idx) => {
            const matchNr = idx + 1;
            if (pairing.home <= 0 || pairing.away <= 0) {
                // Odd team counts produce a bye — nothing to import, but worth saying.
                issues.push({
                    level: "info",
                    code: "ByeSkipped",
                    detail: `kolo ${roundNr}, zápas ${matchNr}`,
                });
                return;
            }
            const groupKey = `${roundNr}|${pairing.rid}`;
            const groupEls = gamesByKey.get(groupKey) ?? [];
            if (groupEls.length === 0) {
                issues.push({
                    level: "warn",
                    code: "MatchWithoutGames",
                    detail: `kolo ${roundNr}, zápas ${matchNr} (${pairing.rid})`,
                });
            } else if (groupEls.length !== info.boardCount) {
                issues.push({
                    level: "warn",
                    code: "BoardCountMismatch",
                    detail: `kolo ${roundNr}, zápas ${matchNr}: ${groupEls.length}/${info.boardCount}`,
                });
            }

            const boards: XmlBoard[] = groupEls.map((g, i) => {
                const sct1 = g.getElementsByTagName("sct1")[0]?.textContent;
                const sct2 = g.getElementsByTagName("sct2")[0]?.textContent;
                return {
                    boardNr: i + 1,
                    homeDesk: intOr(g, "pde1", 0),
                    awayDesk: intOr(g, "pde2", 0),
                    home: parseScore(text(g, "scr1")),
                    away: parseScore(text(g, "scr2")),
                    homeRated: sct1 == null ? null : parseScore(sct1),
                    awayRated: sct2 == null ? null : parseScore(sct2),
                };
            });

            const score = resultByKey.get(`${roundNr}|${pairing.home}|${pairing.away}`);
            matches.push({
                roundNr,
                matchNr,
                rid: pairing.rid,
                homeTeamNo: pairing.home,
                awayTeamNo: pairing.away,
                homeScore: score?.home ?? null,
                awayScore: score?.away ?? null,
                boards,
            });
        });

        rounds.push({ roundNr, date, matches });
    }
    if (rounds.length === 0) return fail("NoRounds");

    // `<game>` groups that no schedule token claimed would silently disappear.
    const claimed = new Set(rounds.flatMap((r) => r.matches.map((m) => `${m.roundNr}|${m.rid}`)));
    for (const key of gamesByKey.keys()) {
        if (!claimed.has(key)) {
            issues.push({
                level: "warn",
                code: "OrphanGameGroup",
                detail: key.replace("|", ", rid="),
            });
        }
    }

    return { competition: { info, teams, roster, rounds }, issues };
}

/** How much of the competition already carries results — drives the import preview
 *  ("kola 1–9 z 11 vyplněna") and tells re-sync which rounds are worth touching. */
export function roundFillState(round: XmlRound): "empty" | "partial" | "complete" {
    let played = 0;
    let total = 0;
    for (const m of round.matches) {
        for (const b of m.boards) {
            total++;
            if (b.home.raw !== "" && (b.home.value > 0 || b.away.value > 0 || b.homeDesk > 0)) {
                played++;
            }
        }
    }
    if (total === 0 || played === 0) return "empty";
    return played === total ? "complete" : "partial";
}

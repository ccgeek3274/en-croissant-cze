// Team-name shortening for the PGN `Event` tag. Faithful TS port of the
// ground-truth-validated Python reference (gen_event.py / demo_resolve.py +
// build_comp_abbr.py), copied from the pgn-base project (backend/src/lib/teamShorten.ts).
// Pure functions: reference data is passed in, so the caller loads it from the bundled
// JSON fixtures. See docs/feat-team-name-shortening.md in pgn-base.

// ---- normalization ----------------------------------------------------------

export function stripDiacritics(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** lowercase, diacritics-free, non-alphanumerics → spaces, collapsed. */
export function norm(s: string): string {
    return stripDiacritics(s)
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Generic prefixes / legal forms / sponsor words that carry no identity. Mirrors
// the union STOP set from demo_resolve.py (incl. sponsor words cayman/pharma/...).
export const STOP = new Set([
    "tj",
    "sk",
    "so",
    "sko",
    "ssk",
    "sks",
    "tjs",
    "ts",
    "sokol",
    "spartak",
    "slavoj",
    "slavia",
    "slovan",
    "banik",
    "lokomotiva",
    "loko",
    "dukla",
    "jiskra",
    "tatran",
    "viktoria",
    "union",
    "sachovy",
    "sachova",
    "sachove",
    "sach",
    "sachy",
    "sachklub",
    "klub",
    "oddil",
    "krouzek",
    "ddm",
    "dum",
    "deti",
    "mladeze",
    "chess",
    "os",
    "zs",
    "z",
    "s",
    "spolek",
    "sportovni",
    "mestsky",
    "mestska",
    "skola",
    "cayman",
    "pharma",
    "caissa",
    "as",
]);

// Prepositions / geographic-adjective qualifiers that carry no club identity.
// Mirrors evaluate.py's CONNECTOR (the authoritative reference the doc says to
// port — NOT demo_resolve.py's shorter set). Dropping the town adjectives here
// is what keeps "Český Brod" from fuzzy-matching "Český Krumlov" on the shared
// "cesky" token. ('z' is covered by STOP.) See docs/feat-team-name-shortening.md.
export const CONNECTOR = new Set([
    "nad",
    "pod",
    "u",
    "v",
    "ve",
    "na",
    "za",
    "do",
    "nove",
    "novy",
    "nova",
    "stare",
    "stary",
    "dolni",
    "horni",
    "velke",
    "velka",
    "male",
    "mala",
    "cesky",
    "ceska",
    "ceske",
    "labem",
    "jizerou",
    "orlici",
    "sazavou",
    "moravou",
]);

export function contentTokens(name: string): string[] {
    return norm(name)
        .split(" ")
        .filter((t) => t && !STOP.has(t) && !CONNECTOR.has(t) && t.length > 1 && !/^\d+$/.test(t));
}

// Locative prepositions that head a Czech toponym qualifier ("<town> nad <řeka>",
// "<town> pod <hora>"). Everything from the preposition to the end of the placename
// is the river/hill qualifier and carries no club identity, so we drop the whole span
// rather than enumerate every river ("nad Labem", "nad Černými lesy", "pod Radhoštěm").
const GEO_PREP = new Set(["nad", "pod"]);

/** Cut a trailing "nad …" / "pod …" locative span off a display label.
 *
 * Fixes the primary leak: seven mined dict labels embed the span verbatim
 * (`Usti nad Labem`, `Bakov nad Jizerou`, …), so a team matching one stamps the full
 * qualifier into the `Event` tag. Diacritics-insensitive so it fires on the raw label.
 * Guard: when the preposition is the *first* token there is no town before it — these
 * are municipality-parts whose name genuinely starts with the preposition
 * (`Pod Cvílínem`, `Pod Dubem`) — so we keep the label unchanged. */
export function stripGeoQualifier(label: string): string {
    const parts = label.split(/\s+/);
    const out: string[] = [];
    for (const p of parts) {
        if (GEO_PREP.has(stripDiacritics(p).toLowerCase())) break;
        out.push(p);
    }
    return out.length ? out.join(" ") : label;
}

function titleToken(t: string): string {
    return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}

// ---- difflib.SequenceMatcher.ratio() (no autojunk; our strings are < 200 chars) -

function totalMatches(a: string, b: string): number {
    const b2j = new Map<string, number[]>();
    for (let j = 0; j < b.length; j++) {
        const arr = b2j.get(b[j]);
        if (arr) arr.push(j);
        else b2j.set(b[j], [j]);
    }
    let total = 0;
    const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
    while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop()!;
        let besti = alo;
        let bestj = blo;
        let bestsize = 0;
        let j2len = new Map<number, number>();
        for (let i = alo; i < ahi; i++) {
            const newj2len = new Map<number, number>();
            const indices = b2j.get(a[i]);
            if (indices) {
                for (const j of indices) {
                    if (j < blo) continue;
                    if (j >= bhi) break;
                    const k = (j2len.get(j - 1) ?? 0) + 1;
                    newj2len.set(j, k);
                    if (k > bestsize) {
                        besti = i - k + 1;
                        bestj = j - k + 1;
                        bestsize = k;
                    }
                }
            }
            j2len = newj2len;
        }
        if (bestsize) {
            total += bestsize;
            if (alo < besti && blo < bestj) queue.push([alo, besti, blo, bestj]);
            if (besti + bestsize < ahi && bestj + bestsize < bhi) {
                queue.push([besti + bestsize, ahi, bestj + bestsize, bhi]);
            }
        }
    }
    return total;
}

export function seqRatio(a: string, b: string): number {
    const t = a.length + b.length;
    return t ? (2.0 * totalMatches(a, b)) / t : 1.0;
}

// ---- reference-data indexes -------------------------------------------------

export type DictRow = {
    label: string;
    clubName: string;
    nameNorm?: string;
    clubId?: number | null;
};
export type DictEntry = {
    label: string;
    clubName: string;
    nameNorm: string;
    clubId: number | null;
    toks: Set<string>;
};
export type GazRow = { full: string; core: string };
export type GazIndex = Map<string, Array<{ fullToks: string[]; core: string }>>;

export function buildDictIndex(rows: DictRow[]): DictEntry[] {
    return rows
        .filter((r) => r.label)
        .map((r) => ({
            label: r.label,
            clubName: r.clubName,
            nameNorm: r.nameNorm ?? norm(r.clubName),
            clubId: r.clubId ?? null,
            toks: new Set(contentTokens(r.clubName)),
        }));
}

export function buildGazIndex(rows: GazRow[]): GazIndex {
    const idx: GazIndex = new Map();
    for (const e of rows) {
        const fullToks = e.full.split(" ");
        const first = fullToks[0];
        const arr = idx.get(first);
        if (arr) arr.push({ fullToks, core: e.core });
        else idx.set(first, [{ fullToks, core: e.core }]);
    }
    return idx;
}

// ---- the three tiers --------------------------------------------------------

/** Fuzzy dict match: 0.6·jaccard + 0.4·seqRatio over content tokens; threshold 0.45.
 *
 * Containment guard: the runtime matches teamName→register *fuzzily by name* (no
 * clubId), so two different towns sharing one generic token (Český **Brod** vs Český
 * **Krumlov**, Velké **Meziříčí** vs Valašské **Meziříčí**) can score over threshold
 * on string similarity alone and hand back the *wrong* town's label. Guard against it:
 * a candidate may only win if every content token of its label is present in the input —
 * i.e. the label we'd stamp is actually justified by this team's name. When it isn't,
 * the caller falls through to the gazetteer (the reliable municipality list). */
export function dictLabel(
    name: string,
    dict: DictEntry[],
): { label: string; score: number } | null {
    const ct = new Set(contentTokens(name));
    const cn = norm(name);
    let best: { label: string; score: number } | null = null;
    for (const r of dict) {
        let interCount = 0;
        for (const t of ct) if (r.toks.has(t)) interCount++;
        if (interCount === 0) continue;
        if (!contentTokens(r.label).every((t) => ct.has(t))) continue;
        const unionCount = new Set([...ct, ...r.toks]).size;
        const jacc = unionCount ? interCount / unionCount : 0;
        const score = 0.6 * jacc + 0.4 * seqRatio(cn, r.nameNorm);
        if (best === null || score > best.score) best = { label: r.label, score };
    }
    return best && best.score >= 0.45 ? best : null;
}

/** Greedy longest contiguous municipality span; never anchored on a STOP/CONNECTOR token. */
export function gazetteerLabel(name: string, gaz: GazIndex): string | null {
    const toks = norm(name).split(" ");
    let best: { len: number; negI: number; core: string } | null = null;
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        for (const e of gaz.get(t) ?? []) {
            const ft = e.fullToks;
            let match = i + ft.length <= toks.length;
            if (match)
                for (let k = 0; k < ft.length; k++)
                    if (toks[i + k] !== ft[k]) {
                        match = false;
                        break;
                    }
            if (!match) continue;
            if (ft.length === 1 && (STOP.has(t) || CONNECTOR.has(t))) continue;
            const cand = { len: ft.length, negI: -i, core: e.core };
            if (
                best === null ||
                cand.len > best.len ||
                (cand.len === best.len && cand.negI > best.negI)
            ) {
                best = cand;
            }
        }
    }
    return best ? best.core : null;
}

export function heuristicLabel(name: string): string {
    const c = contentTokens(name);
    if (c.length) {
        let pick = c[0];
        for (const t of c) if (t.length > pick.length) pick = t;
        return titleToken(pick);
    }
    return stripDiacritics(name).trim();
}

export type ShortenData = {
    dict: DictEntry[];
    gaz: GazIndex;
    overrides?: Map<string, string>; // name_norm → label
};
export type ShortenResult = {
    label: string;
    altTokens: string[];
    source: string;
    confidence: number;
};

export function shorten(name: string, data: ShortenData): ShortenResult {
    let label: string;
    let source: string;
    let confidence: number;

    const ov = data.overrides?.get(norm(name));
    if (ov) {
        label = ov;
        source = "override";
        confidence = 1;
    } else {
        const d = dictLabel(name, data.dict);
        if (d) {
            label = d.label;
            source = "dict";
            confidence = d.score;
        } else {
            const g = gazetteerLabel(name, data.gaz);
            if (g) {
                label = g;
                source = "gazetteer";
                confidence = 0.7;
            } else {
                label = heuristicLabel(name);
                source = "heuristic";
                confidence = 0.3;
            }
        }
    }

    // Drop any "nad …/pod …" locative span from the chosen label (dict labels carry it
    // verbatim). Not applied to admin overrides — a manual label is taken as authored.
    if (source !== "override") label = stripGeoQualifier(label);

    const labLow = stripDiacritics(label).toLowerCase();
    const altTokens = contentTokens(name)
        .filter((t) => !labLow.includes(stripDiacritics(t).toLowerCase()))
        .map(titleToken);

    return { label, altTokens, source, confidence };
}

// ---- competition resolver (closed-set uniqueness) ---------------------------

/** Trailing single A–H letter denotes a club's Nth team. '1.'/'2.' etc. are NOT letters. */
export function parseTeamName(team: string): { base: string; letter: string | null } {
    const m = team.match(/\s+([A-H])$/);
    if (m) return { base: team.slice(0, m.index).trim(), letter: m[1] };
    return { base: team.trim(), letter: null };
}

export type TeamInput = { teamId: number; teamName: string };
export type ResolvedTeam = {
    teamId: number;
    teamName: string;
    label: string; // full label incl. trailing letter
    source: string;
    confidence: number;
};

export function resolveCompetition(teams: TeamInput[], data: ShortenData): ResolvedTeam[] {
    const info = teams.map((t) => {
        const { base, letter } = parseTeamName(t.teamName);
        const s = shorten(base, data);
        return {
            teamId: t.teamId,
            teamName: t.teamName,
            nbase: norm(base),
            letter,
            label: s.label,
            alt: s.altTokens,
            source: s.source,
            confidence: s.confidence,
        };
    });

    // Break collisions between DIFFERENT clubs that share a base label.
    const byLabel = new Map<string, typeof info>();
    for (const d of info) {
        const key = stripDiacritics(d.label).toLowerCase();
        const arr = byLabel.get(key);
        if (arr) arr.push(d);
        else byLabel.set(key, [d]);
    }
    for (const group of byLabel.values()) {
        const distinctClubs = new Set(group.map((d) => d.nbase));
        if (distinctClubs.size > 1) {
            for (const d of group) if (d.alt.length) d.label = `${d.label} ${d.alt[0]}`;
        }
    }

    return info.map((d) => ({
        teamId: d.teamId,
        teamName: d.teamName,
        label: d.letter ? `${d.label} ${d.letter}` : d.label,
        source: d.source,
        confidence: d.confidence,
    }));
}

// ---- competition prefix ('<comp-abbr> <region-abbr> <season>') --------------

export function regionAbbr(regionCode: string): string {
    return stripDiacritics(regionCode);
}

export function seasonAbbr(year: number): string {
    const a = String(year % 100).padStart(2, "0");
    const b = String((year + 1) % 100).padStart(2, "0");
    return `${a}/${b}`;
}

const TYPE: Array<[RegExp, string]> = [
    [/extraliga/, "Extraliga"],
    [/\b1\.?\s*liga/, "1.liga"],
    [/\b2\.?\s*liga/, "2.liga"],
    [/regionalni\s+prebor/, "RP"],
    [/regionalni\s+soutez/, "RS"],
    [/oblastni\s+prebor/, "OP"],
    [/oblastni\s+soutez/, "OS"],
    [/okresni\s+prebor/, "OkP"],
    [/okresni\s+soutez/, "OkS"],
    [/mestsky\s+prebor/, "MP"],
    [/mestska\s+soutez/, "MS"],
    [/krajsky\s+prebor/, "KP"],
    [/krajska\s+soutez/, "KS"],
    [/divize/, "D"],
];
const DIR: Array<[string, string]> = [
    ["vychod", "V"],
    ["zapad", "Z"],
    ["sever", "S"],
    ["jih", "J"],
];
const ROM: Record<string, string> = { i: "I", ii: "II", iii: "III", iv: "IV" };
const MERGE_TYPES = new Set(["KS", "RP", "RS", "OP", "OS", "KP"]);
const ABBR_DROP = new Set(["a", "o", "na", "pro", "druzstev", "sachy", "cz", "sachovy"]);

function stripDashDot(s: string): string {
    return s.replace(/^[-.]+/, "").replace(/[-.]+$/, "");
}

function isTypeWord(tok: string): boolean {
    const t = stripDashDot(stripDiacritics(tok).toLowerCase());
    if (!t || /^[ivx]+$/.test(t)) return true;
    return /^(krajsk\w*|regionalni|oblastni|okresni|mestsk\w*|prebor\w*|soutez\w*|divize|tridy?|druzstev|zakovsk\w*|starsich|zaku|jihocesk\w*|zlinsk\w*|skupina|zakl|finalov\w*|finale|cast|o)$/.test(
        t,
    );
}

/** Returns [abbr, strongTypeMatch]. Port of build_comp_abbr.py:comp_abbr. */
export function compAbbr(name: string): [string, boolean] {
    const orig = name;
    const n = stripDiacritics(name)
        .toLowerCase()
        .replace(/[„“”'"`]/g, "'");

    // Praha: compName already embeds region+abbr ("PŠS KP (Přebor)").
    const mp = n.match(/^\s*p[s]s\s+(k[ps][^()]*)/);
    if (mp) return [mp[1].replace(/\s+/g, "").toUpperCase(), true];

    let typ: string | null = null;
    for (const [pat, ab] of TYPE) {
        if (pat.test(n)) {
            typ = ab;
            break;
        }
    }
    const parts: string[] = [];
    const mnum = n.match(/^\s*(\d+)\./);
    if (typ === "D" && mnum) {
        parts.push(`${mnum[1]}.D`);
        typ = null;
    }
    if (typ) parts.push(typ);

    const mt = n.match(/\b(i{1,3}|iv)\.?\s*tridy/) ?? n.match(/prebor\s+(i{1,3}|iv)\b/);
    if (mt) parts.push(ROM[mt[1]] ?? mt[1].toUpperCase());

    const ml = n.match(/'([a-h])'/) ?? n.match(/skupina\s+'?([a-h])'?\b/);
    if (ml) parts.push(ml[1].toUpperCase());

    for (const [d, ab] of DIR) {
        if (new RegExp(`\\b${d}\\b`).test(n)) {
            parts.push(ab);
            break;
        }
    }

    const mf = n.match(/final\w*\s*'?([a-b])'?/);
    if (mf) parts.push("f" + mf[1].toUpperCase());
    else if (/o\s+postup/.test(n)) parts.push("post");
    else if (/o\s+udrzeni/.test(n)) parts.push("udr");
    else if (/finalov\w+\s+cast/.test(n)) parts.push("fin");

    if (typ && ["OkP", "OkS", "OP", "OS", "MP", "MS"].includes(typ) && !ml) {
        const place = orig
            .split(/\s+/)
            .map((w) => stripDashDot(stripDiacritics(w)))
            .filter((w) => !isTypeWord(w) && w.length > 1);
        if (place.length && !parts.includes("fA") && !parts.includes("fB"))
            parts.push(place[place.length - 1]);
    }

    if (!parts.length) {
        const words = (n.match(/[a-z0-9]+/g) ?? []).filter(
            (w) => !ABBR_DROP.has(w) && w.length > 1,
        );
        parts.push(
            words
                .slice(0, 3)
                .map((w) => w[0].toUpperCase())
                .join("") || "X",
        );
    }

    // Merge a single trailing letter onto the type (KS + A -> KSA).
    if (parts.length === 2 && parts[1].length === 1 && MERGE_TYPES.has(parts[0])) {
        return [parts[0] + parts[1], typ !== null];
    }
    return [parts.join(" "), typ !== null];
}

/** Full prefix. If `overridePrefix` is given (comp_prefix_override row), it wins verbatim. */
export function eventPrefix(
    compName: string,
    regionCode: string,
    season: number,
    overridePrefix?: string | null,
): { prefix: string; strong: boolean; source: string } {
    if (overridePrefix) return { prefix: overridePrefix, strong: true, source: "override" };
    const [ab, strong] = compAbbr(compName);
    return {
        prefix: `${ab} ${regionAbbr(regionCode)} ${seasonAbbr(season)}`,
        strong,
        source: strong ? "auto" : "auto-weak",
    };
}

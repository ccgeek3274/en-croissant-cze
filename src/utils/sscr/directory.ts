// The team directory: one short label and one venue per team — the two halves of
// the ŠSČR export that belong to the leader.
//
//   ŠK KDJS Sedlčany A  →  label "Sedlcany A"  →  Event "KSA 25/26 Sedlcany A-Klokani"
//                       →  site  "Sedlcany"    →  Site  "Sedlcany" (in the matches it hosts)
//
// Both are *derived by default and stored only once someone looks at them*: the
// label comes from the project's shortener over the bundled ŠSČR club dictionary,
// the venue from that label minus the team letter — a club's B team plays where its
// A team does, which is the rule pgn-base settled on.
//
// Resolution lives here, in one place, for two reasons: „Zkratky soutěže" then
// previews exactly what the export will write, and a competition imported before
// this directory existed (every `label`/`site` still null) exports short labels and
// venues anyway instead of silently falling back to full names and no `Site`.

import { shortenTeamNames } from "@/utils/chesscz/labels";
import { parseTeamName } from "@/utils/chesscz/teamShorten";
import { defaultEventPrefix } from "./export";
import type { CompetitionManifest } from "./manifest";

export type DirectoryEntry = {
    no: number;
    /** Full team name as the XML spells it — the key the export looks games up by. */
    name: string;
    label: string;
    site: string;
};

/** Venue for a team whose venue nobody set: its label without the trailing team
 *  letter ("Sedlcany B" → "Sedlcany"). Clubs field their B team in the same hall as
 *  their A team, so the letter is about the squad, never about the place. */
export function defaultSite(label: string): string {
    return parseTeamName(label).base;
}

/** What the directory would say about a team list on its own, ignoring anything the
 *  leader stored. The shortener breaks collisions across the whole closed set of one
 *  competition's teams, so it has to see all of them at once. */
export function deriveDirectory(
    teams: Array<{ no: number; name: string }>,
): Map<number, { label: string; site: string }> {
    const short = shortenTeamNames(teams.map((team) => ({ teamId: team.no, teamName: team.name })));
    const out = new Map<number, { label: string; site: string }>();
    for (const team of teams) {
        const label = short.get(team.no) || team.name;
        out.set(team.no, { label, site: defaultSite(label) });
    }
    return out;
}

/** Label and venue for every team: the leader's stored value where there is one,
 *  the derived default everywhere else. An explicitly empty `site` is honoured —
 *  it means "this team's matches carry no venue", not "derive one". A stored label
 *  feeds the venue too, so renaming a team to "Kralupy B" moves it to "Kralupy". */
export function resolveDirectory(manifest: CompetitionManifest): DirectoryEntry[] {
    const derived = deriveDirectory(manifest.teams);
    return manifest.teams.map((team) => {
        const label = team.label?.trim() || derived.get(team.no)?.label || team.name;
        return { no: team.no, name: team.name, label, site: team.site ?? defaultSite(label) };
    });
}

/** Full team name → short label, for the `Event` tag. */
export function labelMapFrom(manifest: CompetitionManifest): Map<string, string> {
    return new Map(resolveDirectory(manifest).map((team) => [team.name, team.label]));
}

/** Full team name → venue, for the `Site` tag of the matches that team hosts. */
export function siteMapFrom(manifest: CompetitionManifest): Map<string, string> {
    return new Map(resolveDirectory(manifest).map((team) => [team.name, team.site]));
}

/** Write the derived defaults into the manifest at import and re-sync, so the leader
 *  edits real values rather than empty fields. Only untouched entries are filled —
 *  `label` that is blank and `site` that was never set — so this can run again after
 *  every re-sync without undoing a hand edit, and a team that appears only in the
 *  newer XML still arrives with a label and a venue. */
export function prefillDirectory(manifest: CompetitionManifest): CompetitionManifest {
    const resolved = new Map(resolveDirectory(manifest).map((team) => [team.no, team]));
    for (const team of manifest.teams) {
        const entry = resolved.get(team.no);
        if (!team.label) team.label = entry?.label ?? null;
        if (team.site == null) team.site = entry?.site ?? null;
    }
    if (!manifest.options.eventPrefix) {
        manifest.options.eventPrefix =
            defaultEventPrefix(manifest.competition.name, manifest.competition.year) || null;
    }
    return manifest;
}

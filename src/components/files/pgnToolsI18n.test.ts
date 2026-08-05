// Guard against i18n keys that render as raw keys / empty strings in the PGN-tools
// dialogs. Unit-testing the pure logic isn't enough: two real bugs slipped through
// because they only surface at runtime through i18next —
//   1. a dynamic key `t(`…Level${n}`)` that extract could not see, so it pruned it;
//   2. a `{{count}}` key whose value was moved onto empty `_one/_few/…` plurals.
// This test resolves every key the dialogs use, the same way the app does (real
// i18next + the shipped resources), and fails if any comes back empty or unchanged.

import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import csCZ from "@/translation/cs-CZ.json";
import enUS from "@/translation/en-US.json";

// Keys the PGN-tools dialogs render. count-bearing keys carry a sample count so the
// plural form is exercised; interpolation-only keys carry their variables.
const PLAIN_KEYS = [
    "PgnTools.Kontrola.Title",
    "PgnTools.Check.AllClean",
    "PgnTools.Check.Ok",
    "PgnTools.Check.Artifacts.Title",
    "PgnTools.Check.Artifacts.Apply",
    "PgnTools.Check.Variations.Title",
    "PgnTools.Check.Variations.Apply",
    "PgnTools.Check.Variations.Help",
    "PgnTools.Check.Diacritics.Title",
    "PgnTools.Check.Diacritics.Apply",
    "PgnTools.Check.Result.Title",
    "PgnTools.Check.Result.Apply",
    "PgnTools.Check.Event.Title",
    "PgnTools.Check.Event.Empty",
    "PgnTools.Check.Event.OpenInTags",
    "PgnTools.Check.Teams.Title",
    "PgnTools.Check.Teams.Ok",
    "PgnTools.Check.Teams.NotCheckable",
    "PgnTools.Check.Tags.Title",
    "PgnTools.Check.Tags.Hint",
    "PgnTools.Check.Tags.SelectTag",
    "PgnTools.Check.Tags.ListOnly",
    "PgnTools.Check.Tags.Empty",
    "PgnTools.Check.Tags.Take",
    "PgnTools.Check.Tags.Desired",
    "PgnTools.Check.Duplicates.Title",
    "PgnTools.Check.Done",
    "PgnTools.Artifact.Comments",
    "PgnTools.Artifact.Nags",
    "PgnTools.Artifact.Glyphs",
    "PgnTools.Artifact.Escapes",
    "PgnTools.Export.Title",
    "PgnTools.Export.Note",
    "PgnTools.Export.Tags.Title",
    "PgnTools.Export.Tags.Standard",
    "PgnTools.Export.Tags.Full",
    "PgnTools.Export.Tags.Hint",
    "PgnTools.Export.NormalizeNames",
    "PgnTools.Export.NormalizeNamesHint",
    "PgnTools.Export.Save",
    "PgnTools.Import.Title",
    "PgnTools.Import.Help",
    "PgnTools.Import.PickFile",
    "PgnTools.Import.DropHint",
    "PgnTools.Import.NoPgnFiles",
    "PgnTools.Import.PastePlaceholder",
    "PgnTools.Import.TargetGame",
    "PgnTools.Import.ImportedGame",
    "PgnTools.Import.Match",
    "PgnTools.Import.LevelBoth",
    "PgnTools.Import.LevelOne",
    "PgnTools.Import.LevelNone",
    "PgnTools.Import.NoMatch",
    "PgnTools.Import.Unassigned",
    "PgnTools.Import.Legend",
    "PgnTools.Import.Apply",
    "Competition.PickXml",
    "Competition.Issues",
    "Competition.Teams",
    "Competition.Rounds",
    "Competition.Boards",
    "Competition.Games",
    "Competition.Round.Complete",
    "Competition.Round.Partial",
    "Competition.Round.Empty",
    "Competition.EloSource",
    "Competition.EloFide",
    "Competition.EloCze",
    "Competition.NotACompetition",
    "Competition.Import.Title",
    "Competition.Import.Help",
    "Competition.Import.Name",
    "Competition.Import.Create",
    "Competition.Sync.Title",
    "Competition.Sync.Help",
    "Competition.Sync.Apply",
    "Competition.Sync.SameFile",
    "Competition.Sync.UpToDate",
    "Competition.Sync.Unreadable",
    "Competition.Sync.Added",
    "Competition.Sync.Fill",
    "Competition.Sync.Update",
    "Competition.Sync.Conflict",
    "Competition.Sync.Unchanged",
    "Competition.Sync.ConflictsHelp",
    "Competition.Sync.AcceptAll",
    "Competition.Sync.AcceptNone",
    "Competition.Open",
    "Competition.Node.Competition",
    "Competition.Node.Stray",
    "Competition.Forfeit",
    "Competition.Moves.Yes",
    "Competition.Moves.No",
    "Competition.Col.Round",
    "Competition.Col.White",
    "Competition.Col.Black",
    "Competition.Col.Result",
    "Competition.Col.Moves",
    "Competition.Stats.Games",
    "Competition.Stats.WithMoves",
    "Competition.Stats.Decided",
    "Competition.Stats.Placeholders",
    "Competition.Stats.Forfeits",
    "Competition.Headers.Title",
    "Competition.Labels.Title",
    "Competition.Labels.Help",
    "Competition.Labels.Prefix",
    "Competition.Labels.PrefixHelp",
    "Competition.Labels.Teams",
    "Competition.Labels.TeamName",
    "Competition.Labels.Label",
    "Competition.Labels.Site",
    "Competition.Labels.Suggest",
    "Competition.Labels.Save",
    "Competition.Labels.Saved",
    "Competition.Labels.Patterns",
    "Competition.Labels.PatternsHelp",
    "Competition.Labels.EventPattern",
    "Competition.Labels.FilePattern",
    "Competition.Labels.Preview",
    "Competition.Labels.ResetPattern",
    "Competition.Export.Title",
    "Competition.Export.Help",
    "Competition.Export.SampleEvent",
    "Competition.Export.DropForfeits",
    "Competition.Export.StripDiacritics",
    "Competition.Export.WillExport",
    "Competition.Export.WithoutMoves",
    "Competition.Export.WithoutResult",
    "Competition.Export.Placeholders",
    "Competition.Export.Dropped",
    "Competition.Export.FileName",
    "Competition.Export.Clean",
    "Competition.Export.Save",
];

// Parse-issue codes are rendered through a dynamic key, so extract can't see them;
// they survive via the Competition.Issue.* preserve pattern. This list must match
// every code `parseCompetitionXml` can emit.
const ISSUE_CODES = [
    "XmlUnreadable",
    "NotACompetitionXml",
    "MissingInfo",
    "MissingCompName",
    "MissingBoardCount",
    "NoTeams",
    "NoRounds",
    "TeamWithoutNumber",
    "DuplicateTeamNumber",
    "TeamCountMismatch",
    "RosterRowWithoutKey",
    "DuplicateRosterSlot",
    "RosterUnknownTeam",
    "RoundWithoutNumber",
    "ScheduleLengthOdd",
    "MatchWithoutGames",
    "BoardCountMismatch",
    "OrphanGameGroup",
    "ByeSkipped",
].map((code) => `Competition.Issue.${code}`);

const INTERP_KEYS: [string, Record<string, unknown>][] = [
    ["PgnTools.Check.Summary", { total: 3 }],
    ["PgnTools.Check.Artifacts.Detail", { n: 2 }],
    ["PgnTools.Check.Variations.Detail", { n: 2 }],
    ["PgnTools.Check.Variations.LosesLine", { longest: 8, main: 4 }],
    ["PgnTools.Check.Variations.Confirm", { main: 4, longest: 8 }],
    ["PgnTools.Check.Diacritics.Detail", { n: 2 }],
    ["PgnTools.Check.Result.Detail", { n: 2 }],
    ["PgnTools.Check.Event.Uniform", { value: "Liga" }],
    ["PgnTools.Check.Event.Multiple", { n: 3 }],
    ["PgnTools.Check.Teams.Detail", { n: 2 }],
    ["PgnTools.Check.Teams.Expected", { odd: "X", even: "Y" }],
    ["PgnTools.Check.Teams.Missing", { n: 2 }],
    ["PgnTools.Check.Tags.Replace", { n: 2 }],
    ["PgnTools.Check.Tags.ConfirmClear", { tag: "Event" }],
    ["PgnTools.Check.Duplicates.Detail", { n: 2 }],
    ["PgnTools.Export.Done", { count: 2 }],
    ["PgnTools.Import.Done", { matched: 2, appended: 1 }],
    ["PgnTools.Import.WillAppend", { count: 2 }],
    ["PgnTools.Import.Loaded", { count: 3 }],
    ["Competition.RoundNr", { n: 3 }],
    ["Competition.Import.Created", { count: 528 }],
    ["Competition.Sync.Done", { count: 528 }],
    ["Competition.Sync.ConflictsTitle", { n: 3 }],
    ["Competition.Sync.Orphans", { n: 3 }],
    ["Competition.Sync.Duplicates", { rounds: "1.1.1" }],
    ["Competition.Headers.Scope", { label: "1. kolo", count: 48 }],
    ["Competition.Headers.Done", { tag: "Event", count: 2 }],
    ["Competition.Export.Done", { count: 185 }],
    ["Competition.Export.MatchesWithoutMoves", { n: 3, list: "1.2, 1.3" }],
    ["Competition.Export.Unlabelled", { list: "ŠK Rakovník A" }],
    ["Competition.Export.DuplicateEvents", { list: "KSA X-X" }],
];

const LANGS = { "en-US": enUS.translation, "cs-CZ": csCZ.translation };

beforeAll(async () => {
    await i18next.init({
        lng: "en-US",
        fallbackLng: "en-US",
        returnEmptyString: false,
        resources: Object.fromEntries(
            Object.entries(LANGS).map(([lng, translation]) => [lng, { translation }]),
        ),
    });
});

describe.each(Object.keys(LANGS))("PGN-tools i18n keys resolve in %s", (lng) => {
    const resolve = (key: string, vars?: Record<string, unknown>) =>
        i18next.getFixedT(lng)(key, vars ?? {});

    it.each([...PLAIN_KEYS, ...ISSUE_CODES])("%s is present and non-empty", (key) => {
        const value = resolve(key);
        expect(value, `${key} in ${lng}`).not.toBe(key);
        expect(value.trim(), `${key} in ${lng}`).not.toBe("");
    });

    it.each(INTERP_KEYS)("%s resolves (incl. plural) and interpolates", (key, vars) => {
        const value = resolve(key, vars);
        expect(value, `${key} in ${lng}`).not.toBe(key);
        expect(value.trim(), `${key} in ${lng}`).not.toBe("");
        // No unresolved {{placeholder}} left behind.
        expect(value, `${key} in ${lng} has unresolved placeholder`).not.toMatch(/\{\{/);
    });
});

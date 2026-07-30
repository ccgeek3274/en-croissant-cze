# Maintaining this fork

This repository (`ccgeek3274/en-croissant-cze`) is a **downstream fork** of
[`franciscoBSalgueiro/en-croissant`](https://github.com/franciscoBSalgueiro/en-croissant).

Goal: ship a standalone Czech build (Czech UI + integration with the Czech
Chess Federation API, api.chess.cz / ŠSČR) **while still being able to pull in
future upstream changes**. We do **not** upstream our changes.

The whole strategy is: keep our diff against upstream _small and well-known_, so
that merging a new upstream release is a routine, low-conflict operation.

## Branch / remote model

| Ref      | Meaning                                                                            |
| -------- | ---------------------------------------------------------------------------------- |
| `origin` | upstream — `franciscoBSalgueiro/en-croissant` (read-only for us)                   |
| `fork`   | our repo — `ccgeek3274/en-croissant-cze`                                           |
| `master` | **our stable release line** = latest upstream + our patches. Tracks `fork/master`. |

We do **not** keep a local branch that mirrors upstream; the `origin/master`
remote-tracking ref is enough to merge from.

## Syncing a new upstream release

Run this whenever upstream has changes you want:

```bash
# 1. make sure rerere is on (records conflict resolutions, replays them next time)
git config rerere.enabled true
git config rerere.autoupdate true

# 2. get upstream, merge into our release line
git fetch origin
git checkout master
git merge origin/master          # resolve conflicts (see "Patch map" below)

# 3. keep translations in sync (REQUIRED, see i18n note)
./node_modules/.bin/i18next-cli extract   # writes any missing keys
git add src/translation/ && git commit --amend --no-edit   # or a follow-up commit

# 4. verify green locally (mirrors the Test workflow)
./node_modules/.bin/tsgo --noEmit
./node_modules/.bin/oxfmt --check
./node_modules/.bin/oxlint
./node_modules/.bin/i18next-cli extract --ci   # must print "No files were updated"

# 5. push; CI (Test workflow) re-verifies
git push fork master
```

Because `rerere` is enabled, the _second_ time you hit the same additive JSON
conflict it resolves itself. Use **merge, not rebase** — the fork is public and
cloned; rebasing rewrites published history and makes you re-resolve every
conflict on every sync.

## Patch map — what we change vs upstream

Keep this list current. When merging, conflicts can only appear in the
**Modified** files; new files never conflict.

### New files (safe — never conflict)

- `src/utils/chesscz/pgn.ts` — pure PGN/parsing logic (ported from pgn-base). The
  `Event` tag is built from a pre-composed string (`<prefix> <home>-<away>`), not the
  raw competition name (see `labels.ts`).
- `src/utils/chesscz/client.ts` — api.chess.cz client (Tauri fetch, ~1 req/s throttle +
  cache). Endpoints: search, competitions, schedule, round matches, **details**, **table**.
- `src/utils/chesscz/teamShorten.ts` — team-name shortening + competition-prefix logic.
  **Verbatim port** of pgn-base `backend/src/lib/teamShorten.ts` (itself a port of the
  Python reference in the `hlavičky` workspace). Keep in sync with pgn-base; do not
  edit locally except to re-sync.
- `src/utils/chesscz/teamShorten.test.ts` — 11 unit tests over the bundled lean data.
- `src/utils/chesscz/labels.ts` — offline, no-backend equivalent of pgn-base's
  `computeCompetitionLabels`: loads the bundled reference JSON, fetches `/table` +
  meta, runs `resolveCompetition` + `eventPrefix`. Returns the Event prefix + per-team
  short labels; best-effort (falls back to full names on any error).
- `src/utils/chesscz/data/*.json` — **lean** reference set bundled into the app:
  `club_label_dict.json` (493 clubs), `label_overrides.json`, `comp_abbr_overrides.json`.
  The 551 KB `gazetteer_obce.json` is **intentionally NOT bundled** — every registered
  ŠSČR club is already in the mined dictionary, so `dict → heuristic` covers real league
  teams. Add the gazetteer only if unregistered clubs start getting bad labels. Regenerate
  from the `hlavičky` workspace / pgn-base `backend/data/team-shorten/`.
- `src/utils/chesscz/useChessczSearch.ts` — SWR player-search hook
- `src/components/common/ChessczPlayerAutocomplete.tsx` — player autocomplete input
- `src/components/files/ChessczImportDialog.tsx` — "Import from ŠSČR" dialog. Has a
  direct competition-number field (for competitions missing from the current-season
  catalog) and computes/uses the short-label Event prefix.
- `src/translation/cs-CZ.json` — the Czech translation

### Modified upstream files — structural (watch these on upstream refactors)

- `src/components/common/GameInfo.tsx` — White/Black `<input>` replaced by
  `<ChessczPlayerAutocomplete>` (adds one import + swaps two inputs). If upstream
  reworks the header grid, re-apply the swap.
- `src/components/files/Modals.tsx` — adds the "Import from ŠSČR" button above the
  PGN textarea and mounts `<ChessczImportDialog>` (one import + one `Group` + state).

### Modified upstream files — one-liners (low risk)

- `src/index.tsx` — import `cs_CZ` and register `"cs-CZ"` in `resources`
- `i18next.config.ts` — add `"cs-CZ"` to `locales`
- `src/components/settings/SettingsPage.tsx` — add the `Čeština` language option
- `src-tauri/capabilities/main.json` — allow `https://api.chess.cz/**` in `http:default`

### Modified upstream files — translation JSONs (additive; rerere handles repeats)

- `src/translation/en-US.json` — the English `Chesscz.*` source strings
- every other `src/translation/*.json` — empty `Chesscz.*` entries. These are
  **required** (see below) and fall back to English at runtime.

## i18n rules (do not skip)

- **Every used key must exist in every locale file.** `pnpm lint:ci` runs
  `i18next-cli extract --ci`, which fails if any `t("…")` key is missing from any
  locale JSON. After adding/removing keys, always run `i18next-cli extract` and
  commit the result. Untranslated entries stay `""` and fall back to `en-US`
  (the runtime sets `returnEmptyString: false`).
- **Never run `i18next-cli types`.** This project intentionally uses _loose_ i18n
  typing. `types` generates `src/i18next.d.ts` + `src/types/resources.d.ts`, which
  turns on strict key typing and breaks the app's dynamic keys
  (`t(\`Annotate.${x}\`)`, `t(\`GoMode.${x}\`)`, …). If it was run by accident,
delete both files and `tsconfig.tsbuildinfo`, then re-run `tsgo --noEmit`.
- The keys live under the flat `Chesscz.*` namespace. i18next resolves flat dotted
  keys directly (verified), so no nesting is needed.

## Release procedure

1. Sync/verify green as above.
2. Bump the version. We use `<upstreamVersion>-cs[-suffix]` so it's always clear
   which upstream release we're based on (e.g. `0.15.0-cs`, `0.15.0-cs-sscr`).
3. Tag and push the tag; the `Release` workflow builds the macOS `.dmg`
   (Apple Silicon + Intel), Windows, and Linux via GitHub Actions.
4. macOS builds are **unsigned** — users open them with right-click → _Open_ the
   first time. (Signing/notarization needs a paid Apple Developer account; not
   currently done.)

## Environment notes

- Package manager: `pnpm`. In this dev sandbox `pnpm <script>` can fail on the
  install step (ignored build scripts); run the CLIs directly from
  `./node_modules/.bin/` instead. GitHub Actions runs the `pnpm` scripts fine.
- All fork operations (push, CI, releases) are under the `ccgeek3274` GitHub
  account. To move the project to a different account, re-auth with
  `gh auth login` and re-point the `fork` remote.

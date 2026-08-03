// Test fixtures for the competition-XML layer, shared by the sscr unit tests.
//
// Both files are **real data** from the 2025/26 KS A StčŠS competition, trimmed to
// rounds 1 (fully played), 6 and 8 (played, with forfeits) and 10 (drawn but not
// played). `swissmanager.pgn` is what Swiss-Manager itself exported from the same
// tournament — it is the ground truth the reverse-engineered XML mapping is
// checked against, so the two must always come from the same source file.

import { type Competition, parseCompetitionXml } from "../competitionXml";
import competitionXml from "./competition.xml?raw";
import swissManagerPgn from "./swissmanager.pgn?raw";

export { competitionXml, swissManagerPgn };

export function parseFixture(): Competition {
    const { competition, issues } = parseCompetitionXml(competitionXml);
    if (!competition) throw new Error(`fixture did not parse: ${JSON.stringify(issues)}`);
    return competition;
}

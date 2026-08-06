// Who this build says it is. En Croissant CZ is a downstream fork of En Croissant
// (franciscoBSalgueiro/en-croissant, GPL-3.0): the same program, translated into
// Czech and extended with the ŠSČR features (import from chess.cz, the
// competition-leader mode, the ŠSČR export profile).
//
// It ships and updates separately from the original, so wherever the program names
// itself — the About box, the version line in Settings, the window title — it has
// to say which of the two the user is looking at. One place to change it.

export const APP_NAME = "En Croissant CZ";

/** This build's own page (Cloudflare Pages; the source is in `web/`). */
export const APP_SITE = "encroissant.sachytynec.cz";
export const APP_SITE_URL = `https://${APP_SITE}`;

/** The original program — everything not specific to the Czech build is documented
 *  there, and that is where the fork's own page sends people for the details. */
export const UPSTREAM_NAME = "En Croissant";
export const UPSTREAM_SITE = "www.encroissant.org";
export const UPSTREAM_SITE_URL = `https://${UPSTREAM_SITE}`;

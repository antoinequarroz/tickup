// Ticket references in GitHub texts (PR titles, branches, commit messages). Pure: used by the server and the interface.

const KEY = "[A-Za-z][A-Za-z0-9]{1,5}-\\d{1,7}";
// Not inside a word, a path or a longer token ("abcWEB-1", "v-WEB-1"), and not a version or an id ("UTF-8.1", "CVE-2024-123").
const REF = /(?<![A-Za-z0-9/_.-])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})(?![A-Za-z0-9_]|[.-]\d)/g;
// "close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved" (GitHub's own words), and French.
// On one line, with bounded spaces: nothing here can backtrack on a long run of blanks.
const CLOSING = new RegExp(`(?<![A-Za-z-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|ferme|corrige|termine|r[ée]sout)[ \\t]{0,3}:?[ \\t]{1,3}(${KEY}(?:[ \\t]{0,3}(?:,|&|and|et)[ \\t]{1,3}${KEY}){0,20})(?![A-Za-z0-9_]|[.-]\\d)`, "gi");

const MAX_TEXT = 20_000;

/**
 * Every ticket reference in a text, uppercase, once each. In prose (titles, descriptions, commit
 * messages) a reference is written in capitals ("WEB-12"), so that "utf-8" or "top-10" is not one.
 * Branch names have their own rule, see branchRef.
 */
export function refsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.slice(0, MAX_TEXT).matchAll(REF)) {
    if (m[1] !== m[1].toUpperCase()) continue;
    out.add(`${m[1].toUpperCase()}-${Number(m[2])}`);
  }
  return [...out];
}

const BRANCH_REF = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})(?![A-Za-z0-9])/;

/** The ticket a branch is for: the first reference in its name, in any case ("ana/web-12-galerie" gives WEB-12). */
export function branchRef(branch: string | null | undefined): string | null {
  const m = branch ? BRANCH_REF.exec(branch.slice(0, 300)) : null;
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

/** The references that follow a closing word: "Fixes WEB-12, WEB-13" gives both. */
export function closingRefsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.slice(0, MAX_TEXT).matchAll(CLOSING)) for (const r of refsIn(m[1])) out.add(r);
  return [...out];
}

/** A branch name for a ticket: "web-12-page-fiche-bien". Other tickets named in the title are left out of it. */
export function branchName(ref: string, title: string) {
  const slug = title
    .replace(new RegExp(KEY, "g"), " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  // A cut can leave something shaped like a reference at the end ("…-v-2"): harmless, only the first one of a branch counts.
  return slug ? `${ref.toLowerCase()}-${slug}` : ref.toLowerCase();
}

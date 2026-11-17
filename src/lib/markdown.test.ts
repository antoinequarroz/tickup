import { describe, expect, it } from "vitest";
import { type Inline, parseInline, parseMarkdown, safeHref } from "./markdown";

const flat = (nodes: Inline[]): string => nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : flat(n.children))).join("");

describe("texte en ligne", () => {
  it("gras, italique, barré, code", () => {
    expect(parseInline("**Total estimé** : 24 jours")).toEqual([{ type: "bold", children: [{ type: "text", text: "Total estimé" }] }, { type: "text", text: " : 24 jours" }]);
    expect(parseInline("un *mot* et _autre_ puis ~~fini~~ et `x*y*`").map((n) => n.type)).toEqual(["text", "italic", "text", "italic", "text", "strike", "text", "code"]);
    expect(parseInline("**gras avec `code` et *italique***")[0]).toMatchObject({ type: "bold" });
  });

  it("laisse tranquille ce qui n'est pas de la mise en forme", () => {
    for (const s of ["nom_de_fichier_long.ts", "2 * 3 * 4", "a ** b", "prix : 5* environ", "`pas fermé", "**pas fermé", "[lien cassé](", "x < y > z", "snake_case et _privé"]) expect(flat(parseInline(s))).toBe(s.replace(/_privé/, "_privé"));
    expect(parseInline("nom_de_fichier_long.ts")).toEqual([{ type: "text", text: "nom_de_fichier_long.ts" }]);
  });

  it("liens : Markdown, chevrons de Linear, adresse nue", () => {
    expect(parseInline("[Cairn](<http://cairn.antoinequarroz.ch>)")).toEqual([{ type: "link", href: "http://cairn.antoinequarroz.ch", children: [{ type: "text", text: "Cairn" }] }]);
    expect(parseInline("voir [PR #8](https://github.com/a/b/pull/8).")[1]).toMatchObject({ type: "link", href: "https://github.com/a/b/pull/8" });
    expect(parseInline("va sur https://tickup.postmelo.ch/login, merci")[1]).toMatchObject({ type: "link", href: "https://tickup.postmelo.ch/login" });
    expect(parseInline("[wiki](https://fr.wikipedia.org/wiki/Cairn_(montagne))")[0]).toMatchObject({ href: "https://fr.wikipedia.org/wiki/Cairn_(montagne)" });
  });

  it("mentions de Linear : le ticket ou la PR garde son nom, avec son lien", () => {
    const s = 'suivi dans (<issue id="da98" label="ANT-174" href="https://linear.app/x/issue/ANT-174/p3" />, <pull-request id="d4" label="a/b#233" href="https://linear.app/x/review/y" />).';
    const nodes = parseInline(s);
    expect(flat(nodes)).toBe("suivi dans (ANT-174, a/b#233).");
    expect(nodes.filter((n) => n.type === "link").map((n) => n.type === "link" && n.href)).toEqual(["https://linear.app/x/issue/ANT-174/p3", "https://linear.app/x/review/y"]);
  });

  it("n'accepte que des adresses qui ouvrent une page", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", " javascript:alert(1)", "//evil.example", "/relatif", "https://a b", 'https://a"b', ""]) expect(safeHref(bad), bad).toBeNull();
    expect(safeHref("<https://exemple.ch/a?b=1>")).toBe("https://exemple.ch/a?b=1");
    expect(safeHref("mailto:info@exemple.ch")).toBe("mailto:info@exemple.ch");
    // A refused address stays visible as text, never as a link.
    expect(parseInline("[clic](javascript:alert(1))").every((n) => n.type === "text")).toBe(true);
    expect(parseInline('<issue label="X" href="javascript:alert(1)" />')).toEqual([{ type: "text", text: "X" }]);
  });
});

describe("blocs", () => {
  it("titres, paragraphes, listes à puces de Linear, règle", () => {
    const blocks = parseMarkdown("## Déjà en place\n\n* Notes en **Markdown**\n* Coffre chiffré\n  * sous-point\n\nUn paragraphe\nsur deux lignes.\n\n---\n\n1. un\n2. deux");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "list", "paragraph", "rule", "list"]);
    expect(blocks[1]).toMatchObject({ ordered: false, items: [{ depth: 0 }, { depth: 0 }, { depth: 1 }] });
    expect(blocks[2]).toMatchObject({ lines: [[{ text: "Un paragraphe" }], [{ text: "sur deux lignes." }]] });
    expect(blocks[4]).toMatchObject({ ordered: true, start: 1 });
  });

  it("cases à cocher, puces « • » et « - », citation, bloc de code intact", () => {
    const blocks = parseMarkdown("- [ ] à faire\n- [x] fait\n\n• Site public\n\n> cité\n\n```\n**pas du gras**\n* pas une liste\n```");
    expect(blocks[0]).toMatchObject({ type: "list", items: [{ checked: false }, { checked: true }] });
    expect(blocks[1]).toMatchObject({ type: "list", items: [{ checked: null }] });
    expect(blocks[2]).toMatchObject({ type: "quote" });
    expect(blocks[3]).toEqual({ type: "code", text: "**pas du gras**\n* pas une liste" });
  });

  it("ne perd aucun texte et ne se bloque pas sur un texte tordu", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("```\nbloc jamais fermé")).toEqual([{ type: "code", text: "bloc jamais fermé" }]);
    const t0 = Date.now();
    parseMarkdown(`${"*".repeat(20_000)} ${"[".repeat(20_000)} ${"_a".repeat(20_000)} ${"`".repeat(9_999)}`);
    parseMarkdown(Array.from({ length: 5000 }, (_, i) => `${" ".repeat(i % 9)}* point **${i}**`).join("\n"));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

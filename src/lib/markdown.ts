/**
 * A small Markdown reader for descriptions and comments: what people type here and what Linear exports.
 * It produces a tree, never HTML: the page builds elements from it, so no text can become markup.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold" | "italic" | "strike"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type ListItem = { depth: number; checked: boolean | null; children: Inline[] };

export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; text: string }
  | { type: "rule" };

/** Texts are bounded where they are saved; this keeps a pathological one from freezing the page. */
const MAX_LENGTH = 200_000;

/** Only addresses that open a page or a mail: never "javascript:" or "data:". */
export function safeHref(raw: string): string | null {
  const url = raw.trim().replace(/^<(.*)>$/, "$1").trim();
  // Invisible and direction-changing characters could make an address look like another one.
  if (!url || url.length > 2000 || /[\s<>"\u0000-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(url)) return null;
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(url) ? url : null;
}

const ATTR = /([a-z-]+)="([^"]*)"/g;

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR)) found[m[1]] = m[2];
  return found;
}

const text = (value: string): Inline => ({ type: "text", text: value });

/** Adjacent pieces of plain text become one. */
function push(out: Inline[], node: Inline) {
  const last = out[out.length - 1];
  if (node.type === "text" && last?.type === "text") last.text += node.text;
  else if (node.type !== "text" || node.text) out.push(node);
}

const WORD = /[\p{L}\p{N}]/u;

/** One line of text: code, bold, italic, strike, links, bare addresses, and Linear's ticket tags. */
export function parseInline(source: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  // Once a mark has no closer after a position, it has none after any later one either:
  // remembering it keeps a line full of lone "*" from costing a search per character.
  const none = new Map<string, number>();
  const closing = (mark: string, from: number) => {
    if (from >= (none.get(mark) ?? Infinity)) return -1;
    const at = source.indexOf(mark, from);
    if (at < 0) none.set(mark, Math.min(from, none.get(mark) ?? Infinity));
    return at > from ? at : -1;
  };
  /** The closer of a single "*" or "_": not after a space, and "_" not inside a word. */
  const emphasisEnd = (ch: string, from: number) => {
    const key = `${ch}!`;
    if (from >= (none.get(key) ?? Infinity)) return -1;
    let end = closing(ch, from);
    while (end > 0 && (source[end - 1] === " " || (ch === "_" && source[end + 1] && WORD.test(source[end + 1])))) end = closing(ch, end + 1);
    if (end < 0) none.set(key, from);
    return end;
  };
  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i);

    if (ch === "\\" && i + 1 < source.length && /[\\`*_~[\]()<>#-]/.test(source[i + 1])) {
      push(out, text(source[i + 1]));
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = closing("`", i + 1);
      if (end > 0) {
        push(out, { type: "code", text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 4) {
      const pair = rest.startsWith("**") ? "**" : rest.startsWith("~~") ? "~~" : null;
      if (pair) {
        const end = closing(pair, i + 2);
        if (end > 0 && source[i + 2] !== " ") {
          push(out, { type: pair === "**" ? "bold" : "strike", children: parseInline(source.slice(i + 2, end), depth + 1, links) });
          i = end + 2;
          continue;
        }
      }
      // "_" inside a word (snake_case, a file name) is not emphasis.
      if ((ch === "*" || ch === "_") && source[i + 1] && source[i + 1] !== " " && source[i + 1] !== ch && !(ch === "_" && i > 0 && WORD.test(source[i - 1]))) {
        const end = emphasisEnd(ch, i + 1);
        if (end > 0) {
          push(out, { type: "italic", children: parseInline(source.slice(i + 1, end), depth + 1, links) });
          i = end + 1;
          continue;
        }
      }
      if (ch === "[" && links) {
        const m = /^\[([^\]\n]{1,500})\]\((<[^>\n]{1,2000}>|[^()\s]{1,2000}(?:\([^()\s]*\)[^()\s]*)*)\)/.exec(rest);
        const href = m && safeHref(m[2]);
        if (m && href) {
          // No link inside a link: Linear writes a bare address as [address](<address>).
          push(out, { type: "link", href, children: parseInline(m[1], depth + 1, false) });
          i += m[0].length;
          continue;
        }
      }
    }
    if (ch === "<" && links) {
      // Linear writes a mention of a ticket or a pull request as a tag: keep its label, linked.
      const tag = /^<(issue|pull-request)\s[^<>\n]{0,1500}\/>/.exec(rest);
      if (tag) {
        const a = attributes(tag[0]);
        const href = safeHref(a.href ?? "");
        const label = a.label || a.id || tag[1];
        push(out, href ? { type: "link", href, children: [text(label)] } : text(label));
        i += tag[0].length;
        continue;
      }
      const auto = /^<((?:https?:\/\/|mailto:)[^<>\s]{1,2000})>/i.exec(rest);
      if (auto && safeHref(auto[1])) {
        push(out, { type: "link", href: auto[1], children: [text(auto[1])] });
        i += auto[0].length;
        continue;
      }
    }
    if (links && (ch === "h" || ch === "H") && (i === 0 || !WORD.test(source[i - 1]))) {
      const bare = /^https?:\/\/[^\s<>"]{2,2000}/i.exec(rest);
      if (bare) {
        // A sentence's closing punctuation is not part of the address.
        const url = bare[0].replace(/[.,;:!?)\]}'»]+$/, "");
        const href = safeHref(url);
        if (href) {
          push(out, { type: "link", href, children: [text(url)] });
          i += url.length;
          continue;
        }
      }
    }
    push(out, text(ch));
    i++;
  }
  return out;
}

const BULLET = /^(\s*)(?:[*+\-•])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(\S.*)$/;
/** A heading's text, without its optional closing "##" (only when a space separates it: "C#" stays). */
function headingText(raw: string): string {
  const t = raw.trimEnd();
  let end = t.length;
  while (end > 0 && t[end - 1] === "#") end--;
  if (end < t.length && end > 0 && (t[end - 1] === " " || t[end - 1] === "\t")) return t.slice(0, end).trimEnd() || t;
  return t;
}
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>\s?(.*)$/;

const indent = (spaces: string) => Math.min(4, Math.floor(spaces.replace(/\t/g, "  ").length / 2));

/** The whole text, block by block. */
export function parseMarkdown(source: string, depth = 0): Block[] {
  const lines = source.slice(0, MAX_LENGTH).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: Math.min(3, heading[1].length) as 1 | 2 | 3, children: parseInline(headingText(heading[2])) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    // Linear's ">>> Titre" … ">>>": a quoted section that may hold paragraphs and lists.
    const section = /^\s*>>>\s*(.*)$/.exec(line);
    if (section && depth < 3) {
      const inner: string[] = section[1].trim() ? [`**${section[1].trim()}**`, ""] : [];
      i++;
      while (i < lines.length && !/^\s*>>>\s*$/.test(lines[i])) inner.push(lines[i++]);
      i++;
      blocks.push({ type: "quote", blocks: parseMarkdown(inner.join("\n"), depth + 1) });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ type: "quote", blocks: depth < 3 ? parseMarkdown(quoted.join("\n"), depth + 1) : [{ type: "paragraph", lines: quoted.map((q) => parseInline(q)) }] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const items: ListItem[] = [];
      const base = indent((bullet ?? numbered)![1]);
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        const n = b ? null : NUMBERED.exec(lines[i]);
        if (b || n) {
          // A list of the other kind at the first level starts a new list; deeper, it is a sub-list.
          const depth = Math.max(0, indent((b ?? n)![1]) - base);
          if (depth === 0 && !!n !== ordered) break;
          items.push(b ? { depth, checked: b[2] === undefined ? null : b[2] !== " ", children: parseInline(b[3]) } : { depth, checked: null, children: parseInline(n![3]) });
          i++;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          // An indented line continues the item above.
          const last = items[items.length - 1];
          push(last.children, text(" "));
          for (const node of parseInline(lines[i].trim())) push(last.children, node);
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered, start: numbered ? Number(numbered[2]) : 1, items });
      continue;
    }
    const paragraph: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !RULE.test(lines[i]) && !QUOTE.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) paragraph.push(parseInline(lines[i++].trim()));
    blocks.push({ type: "paragraph", lines: paragraph });
  }
  return blocks;
}

const flatten = (nodes: Inline[]): string => nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : flatten(n.children))).join("");

/** The words of a Markdown text without its marks, for one-line previews (project and epic cards). */
export function plainText(source: string, max = 600): string {
  const out: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (out.join(" ").length > max) return;
      if (b.type === "paragraph") out.push(b.lines.map(flatten).join(" "));
      else if (b.type === "heading") out.push(flatten(b.children));
      else if (b.type === "list") out.push(b.items.map((i) => flatten(i.children)).join(" · "));
      else if (b.type === "quote") walk(b.blocks);
      else if (b.type === "code") out.push(b.text);
    }
  };
  walk(parseMarkdown(source.slice(0, max * 4)));
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, max);
}

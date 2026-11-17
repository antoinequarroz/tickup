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
  | { type: "quote"; lines: Inline[][] }
  | { type: "code"; text: string }
  | { type: "rule" };

/** Texts are bounded where they are saved; this keeps a pathological one from freezing the page. */
const MAX_LENGTH = 200_000;

/** Only addresses that open a page or a mail: never "javascript:" or "data:". */
export function safeHref(raw: string): string | null {
  const url = raw.trim().replace(/^<(.*)>$/, "$1").trim();
  if (!url || url.length > 2000 || /[\s<>"\u0000-\u001f]/.test(url)) return null;
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
export function parseInline(source: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  const closing = (mark: string, from: number) => {
    const at = source.indexOf(mark, from);
    return at > from ? at : -1;
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
          push(out, { type: pair === "**" ? "bold" : "strike", children: parseInline(source.slice(i + 2, end), depth + 1) });
          i = end + 2;
          continue;
        }
      }
      // "_" inside a word (snake_case, a file name) is not emphasis.
      if ((ch === "*" || ch === "_") && source[i + 1] && source[i + 1] !== " " && source[i + 1] !== ch && !(ch === "_" && i > 0 && WORD.test(source[i - 1]))) {
        let end = closing(ch, i + 1);
        while (end > 0 && (source[end - 1] === " " || (ch === "_" && source[end + 1] && WORD.test(source[end + 1])))) end = closing(ch, end + 1);
        if (end > 0) {
          push(out, { type: "italic", children: parseInline(source.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
      if (ch === "[") {
        const m = /^\[([^\]\n]{1,500})\]\((<[^>\n]{1,2000}>|[^()\s]{1,2000}(?:\([^()\s]*\)[^()\s]*)*)\)/.exec(rest);
        const href = m && safeHref(m[2]);
        if (m && href) {
          push(out, { type: "link", href, children: parseInline(m[1], depth + 1) });
          i += m[0].length;
          continue;
        }
      }
    }
    if (ch === "<") {
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
      if (auto) {
        push(out, { type: "link", href: auto[1], children: [text(auto[1])] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || !WORD.test(source[i - 1]))) {
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
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>\s?(.*)$/;

const indent = (spaces: string) => Math.min(4, Math.floor(spaces.replace(/\t/g, "  ").length / 2));

/** The whole text, block by block. */
export function parseMarkdown(source: string): Block[] {
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
      blocks.push({ type: "heading", level: Math.min(3, heading[1].length) as 1 | 2 | 3, children: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(parseInline(QUOTE.exec(lines[i++])![1]));
      blocks.push({ type: "quote", lines: quoted });
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
          last.children = [...last.children, text(" "), ...parseInline(lines[i].trim())];
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

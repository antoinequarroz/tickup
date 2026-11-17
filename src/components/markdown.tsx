import { Fragment, useMemo } from "react";
import { type Block, type Inline, parseMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function Spans({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "code":
            return (
              <code key={i} className="rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-[0.88em]">
                {n.text}
              </code>
            );
          case "bold":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Spans nodes={n.children} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <Spans nodes={n.children} />
              </em>
            );
          case "strike":
            return (
              <s key={i}>
                <Spans nodes={n.children} />
              </s>
            );
          case "link":
            return (
              // A click on a link opens it: it must not also start editing the text around it.
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="break-words text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                <Spans nodes={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Lines({ lines }: { lines: Inline[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Spans nodes={line} />
        </Fragment>
      ))}
    </>
  );
}

const HEADINGS = { 1: "text-[1.25em]", 2: "text-[1.12em]", 3: "text-[1em]" } as const;
const DEPTHS = ["", "ml-5", "ml-10", "ml-[60px]", "ml-20"];

function BlockView({ block }: { block: Block }): React.ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <Lines lines={block.lines} />
        </p>
      );
    case "heading": {
      const Tag = `h${block.level + 2}` as "h3" | "h4" | "h5";
      return (
        <Tag className={cn("mt-1 font-semibold text-ink", HEADINGS[block.level])}>
          <Spans nodes={block.children} />
        </Tag>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      let n = block.start - 1;
      return (
        <Tag className="flex flex-col gap-1">
          {block.items.map((item, i) => {
            if (item.depth === 0) n++;
            return (
              <li key={i} className={cn("flex gap-2", DEPTHS[item.depth])}>
                {item.checked === null ? (
                  <span aria-hidden className="w-4 shrink-0 text-right text-ink-3 tabular-nums select-none">
                    {block.ordered && item.depth === 0 ? `${n}.` : "•"}
                  </span>
                ) : (
                  <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-label={item.checked ? "Fait" : "À faire"} className="pointer-events-none mt-[0.3em] size-3.5 shrink-0 accent-ink" />
                )}
                <span className={cn("min-w-0 flex-1", item.checked && "text-ink-3 line-through")}>
                  <Spans nodes={item.children} />
                </span>
              </li>
            );
          })}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-line-strong pl-3 text-ink-3">
          {block.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-[8px] border border-line bg-surface-2 px-3 py-2 font-mono text-[0.88em] leading-normal">
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr className="border-line" />;
  }
}

/** Text written in Markdown, shown formatted. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("flex flex-col gap-2.5 break-words", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

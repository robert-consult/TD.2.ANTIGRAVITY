import { Fragment, type ReactNode } from "react";

type MessageBodyProps = {
  body: string;
  contentFormat?: string | null;
  className?: string;
};

function renderInlineMarkdown(input: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(input.slice(lastIndex, start));
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${start}-b`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={`${start}-c`} className="rounded bg-black/35 px-1 py-0.5 font-mono text-[0.92em] text-sky-200">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`${start}-a`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-300 underline decoration-sky-500/60 underline-offset-2 hover:text-sky-200"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`${start}-i`} className="italic text-gray-100">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < input.length) {
    nodes.push(input.slice(lastIndex));
  }

  return nodes;
}

function renderMarkdownLines(body: string) {
  const lines = body.split(/\r?\n/);
  return lines.map((line, idx) => {
    const key = `line-${idx}`;
    if (!line.trim()) {
      return <div key={key} className="h-2" />;
    }

    if (line.startsWith("### ")) {
      return (
        <h4 key={key} className="text-sm font-semibold text-white/95 mt-1">
          {renderInlineMarkdown(line.slice(4))}
        </h4>
      );
    }

    if (line.startsWith("## ")) {
      return (
        <h3 key={key} className="text-base font-semibold text-white mt-1">
          {renderInlineMarkdown(line.slice(3))}
        </h3>
      );
    }

    if (line.startsWith("# ")) {
      return (
        <h2 key={key} className="text-lg font-semibold text-white mt-1">
          {renderInlineMarkdown(line.slice(2))}
        </h2>
      );
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      return (
        <div key={key} className="flex items-start gap-2">
          <span className="mt-[0.4rem] h-1.5 w-1.5 rounded-full bg-sky-300/80" />
          <span className="min-w-0">{renderInlineMarkdown(line.slice(2))}</span>
        </div>
      );
    }

    return <Fragment key={key}>{renderInlineMarkdown(line)}</Fragment>;
  });
}

export function MessageBody({ body, contentFormat, className }: MessageBodyProps) {
  const text = String(body ?? "");
  const format = String(contentFormat ?? "PLAINTEXT").toUpperCase();

  if (format !== "MARKDOWN") {
    return <div className={className ?? "whitespace-pre-wrap break-words"}>{text}</div>;
  }

  return <div className={className ?? "space-y-1 whitespace-pre-wrap break-words"}>{renderMarkdownLines(text)}</div>;
}

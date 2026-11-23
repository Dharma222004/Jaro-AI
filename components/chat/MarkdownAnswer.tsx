'use client';

import React from 'react';

interface ParsedListItem {
  children: ParsedListItem[];
  ordered: boolean;
  text: string;
}

export function MarkdownAnswer({
  content,
  citationScope,
  onCitationClick,
}: {
  content: string;
  citationScope?: string;
  onCitationClick?: (sourceNumber: number) => void;
}) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const image = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)(?:\s+(.+))?$/);
    if (image) {
      nodes.push(<ResearchImage alt={image[1] || 'Research image'} caption={image[3]} key={`image-${index}`} src={image[2]} />);
      index += 1;
      continue;
    }

    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[index + 1] ?? '')) {
      const headers = splitTableRow(line);
      const alignRow = lines[index + 1] ?? '';
      const alignments = splitTableRow(alignRow).map((cell) => {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center' as const;
        if (trimmed.endsWith(':')) return 'right' as const;
        if (trimmed.startsWith(':')) return 'left' as const;
        return 'left' as const;
      });
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      const isGateAudit = headers.length === 6 || headers.some((h) => /Gate/i.test(h));
      const isTradePlan = headers.length === 3 || headers.some((h) => /Level \/ Parameter|Deterministic Output/i.test(h));
      const tableClasses = [
        'chat-table',
        isGateAudit ? 'chat-table-gate-audit' : '',
        isTradePlan ? 'chat-table-trade-plan' : '',
        `chat-table-cols-${headers.length}`,
      ].filter(Boolean).join(' ');

      nodes.push(
        <div className="chat-table-container" key={`table-${index}`}>
          {headers.length >= 4 && (
            <div className="table-scroll-hint" aria-hidden="true">
              <span>← Swipe to view all {headers.length} columns →</span>
            </div>
          )}
          <div className="chat-table-wrap">
            <table className={tableClasses}>
              <thead>
                <tr>
                  {headers.map((header, cellIndex) => (
                    <th key={cellIndex} style={{ textAlign: alignments[cellIndex] ?? 'left' }}>
                      {inline(header, citationScope, onCitationClick)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {headers.map((_, cellIndex) => (
                      <td key={cellIndex} style={{ textAlign: alignments[cellIndex] ?? 'left' }}>
                        {inline(row[cellIndex] ?? '', citationScope, onCitationClick)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>,
      );
      continue;
    }

    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && /^```/.test(lines[index].trim())) index += 1;
      nodes.push(
        <div className="chat-code-block" key={`code-${index}`}>
          {language && <div className="code-lang-tag">{language}</div>}
          <pre><code>{code.join('\n')}</code></pre>
        </div>,
      );
      continue;
    }

    const heading = line.trim().match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      nodes.push(<HeadingTag key={`h-${index}`}>{inline(text, citationScope, onCitationClick)}</HeadingTag>);
      index += 1;
      continue;
    }

    if (/^---+$|^\*\*\*+$/.test(line.trim())) {
      nodes.push(<hr className="chat-divider" key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (isListLine(line)) {
      const { items, nextIndex } = parseListBlock(lines, index);
      nodes.push(...renderLists(items, `list-${index}`, citationScope, onCitationClick));
      index = nextIndex;
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    nodes.push(
      <p key={`p-${index}`}>
        {paragraphLines.map((pLine, pIdx) => (
          <React.Fragment key={pIdx}>
            {pIdx > 0 && ' '}
            {inline(pLine, citationScope, onCitationClick)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="markdown-answer">{nodes}</div>;
}

function ResearchImage({ alt, caption, src }: { alt: string; caption?: string; src: string }) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  if (failed) return null;

  return (
    <figure className="chat-figure">
      <div className={`research-image-wrapper ${loaded ? 'is-loaded' : 'is-loading'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={alt}
          className="research-image"
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          src={src}
        />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  return /^(#{1,4}\s+|>\s?|```|---+$|\*\*\*+$)/.test(line.trim())
    || isListLine(line)
    || (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[index + 1] ?? ''));
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*]|\d+\.)\s+/.test(line);
}

function parseListBlock(lines: string[], startIndex: number): { items: ParsedListItem[]; nextIndex: number } {
  const rawItems: Array<{ indent: number; ordered: boolean; text: string }> = [];
  let index = startIndex;

  while (index < lines.length && isListLine(lines[index])) {
    const match = lines[index].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (!match) break;
    rawItems.push({
      indent: match[1].replace(/\t/g, '  ').length,
      ordered: /\d+\./.test(match[2]),
      text: match[3],
    });
    index += 1;
  }

  const root: ParsedListItem[] = [];
  const stack: Array<{ indent: number; items: ParsedListItem[] }> = [{ indent: -1, items: root }];

  rawItems.forEach((raw) => {
    while (stack.length > 1 && raw.indent <= stack[stack.length - 1].indent) stack.pop();
    const node: ParsedListItem = { children: [], ordered: raw.ordered, text: raw.text };
    stack[stack.length - 1].items.push(node);
    stack.push({ indent: raw.indent, items: node.children });
  });

  return { items: root, nextIndex: index };
}

function renderLists(items: ParsedListItem[], keyPrefix: string, citationScope?: string, onCitationClick?: (sourceNumber: number) => void): React.ReactNode[] {
  const output: React.ReactNode[] = [];
  let index = 0;

  while (index < items.length) {
    const ordered = items[index].ordered;
    const group: ParsedListItem[] = [];
    while (index < items.length && items[index].ordered === ordered) {
      group.push(items[index]);
      index += 1;
    }
    const ListTag = ordered ? 'ol' : 'ul';
    output.push(
      <ListTag key={`${keyPrefix}-${index}`}>
        {group.map((item, itemIndex) => (
          <li key={itemIndex}>
            {inline(item.text, citationScope, onCitationClick)}
            {item.children.length > 0 && renderLists(item.children, `${keyPrefix}-${index}-${itemIndex}`, citationScope, onCitationClick)}
          </li>
        ))}
      </ListTag>,
    );
  }

  return output;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function inline(text: string, citationScope?: string, onCitationClick?: (sourceNumber: number) => void): React.ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\d+\]|\[[a-zA-Z][a-zA-Z0-9_-]*\]|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_))/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeVal = part.slice(1, -1);
      const isStatus = ['PASS', 'WAIT', 'FAIL', 'UNVERIFIED', 'N/A', 'EXTENDED', 'ACTIONABLE', 'WAIT_FOR_ENTRY'].includes(codeVal);
      return <code key={index} className={isStatus ? `badge-status badge-${codeVal.toLowerCase().replace(/_/g, '-')}` : undefined}>{codeVal}</code>;
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;

    const citation = part.match(/^\[(\d+)\]$/);
    if (citation) {
      const sourceNumber = Number(citation[1]);
      return (
        <a
          className="source-citation"
          href={citationScope ? `#${citationScope}-source-${sourceNumber}` : '#sources'}
          key={index}
          onClick={(event) => {
            if (!onCitationClick) return;
            event.preventDefault();
            onCitationClick(sourceNumber);
          }}
          title={`View source [${sourceNumber}]`}
        >
          {sourceNumber}
        </a>
      );
    }
    if (/^\[[a-zA-Z][a-zA-Z0-9_-]*\]$/.test(part)) {
      return <span className="source-citation" key={index}>{part.slice(1, -1)}</span>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

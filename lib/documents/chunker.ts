// lib/documents/chunker.ts
import type { ParsedDocument } from './parser';

export interface DocumentChunkData {
  chunkIndex: number;
  content: string;
  contentType: 'text' | 'table' | 'heading' | 'list';
  pageNumber?: number;
  sectionTitle?: string;
  metadata: Record<string, unknown>;
}

const MAX_CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 100;
const OVERLAP_CHARS = 150;

export function chunkDocument(doc: ParsedDocument, options?: { maxChars?: number; overlap?: number }): DocumentChunkData[] {
  const maxChars = options?.maxChars ?? MAX_CHUNK_CHARS;
  const overlap = options?.overlap ?? OVERLAP_CHARS;
  const chunks: DocumentChunkData[] = [];

  // Add headings as standalone chunks
  for (const heading of doc.headings) {
    if (heading.text.trim().length > 2) {
      chunks.push({
        chunkIndex: 0,
        content: heading.text,
        contentType: 'heading',
        pageNumber: heading.pageNumber,
        sectionTitle: heading.text,
        metadata: { level: heading.level },
      });
    }
  }

  // Add tables as structured chunks
  for (const table of doc.tables) {
    const tableText = formatTable(table);
    if (tableText.length > MIN_CHUNK_CHARS) {
      // Split large tables
      const tableChunks = splitText(tableText, maxChars * 2, 0);
      for (const tc of tableChunks) {
        chunks.push({
          chunkIndex: 0,
          content: tc,
          contentType: 'table',
          pageNumber: table.pageNumber,
          sectionTitle: table.title,
          metadata: { tableTitle: table.title, rowCount: table.rows.length },
        });
      }
    }
  }

  // Split main text with overlap
  const textChunks = splitText(doc.text, maxChars, overlap);
  let currentSection = '';
  let currentPage = 1;

  for (const chunk of textChunks) {
    // Try to find the current section from headings
    for (const heading of doc.headings) {
      if (chunk.includes(heading.text)) {
        currentSection = heading.text;
        if (heading.pageNumber) currentPage = heading.pageNumber;
      }
    }
    if (chunk.trim().length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunkIndex: 0,
        content: chunk.trim(),
        contentType: 'text',
        pageNumber: currentPage,
        sectionTitle: currentSection || undefined,
        metadata: {},
      });
    }
  }

  // Re-index
  return chunks.map((chunk, i) => ({ ...chunk, chunkIndex: i }));
}

function formatTable(table: ParsedDocument['tables'][0]): string {
  const lines: string[] = [];
  if (table.title) lines.push(`Table: ${table.title}`);
  for (const row of table.rows) {
    lines.push(row.join(' | '));
  }
  return lines.join('\n');
}

function splitText(text: string, maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length <= maxChars) {
      current = current ? current + '\n\n' + para : para;
    } else {
      if (current.length >= MIN_CHUNK_CHARS) chunks.push(current);
      // If para itself is too long, split by sentences
      if (para.length > maxChars) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentGroup = '';
        for (const sent of sentences) {
          if ((sentGroup + sent).length <= maxChars) {
            sentGroup = sentGroup ? sentGroup + ' ' + sent : sent;
          } else {
            if (sentGroup.length >= MIN_CHUNK_CHARS) chunks.push(sentGroup);
            sentGroup = sent;
          }
        }
        if (sentGroup.length >= MIN_CHUNK_CHARS) chunks.push(sentGroup);
        current = overlap > 0 && chunks.length > 0 ? chunks[chunks.length - 1].slice(-overlap) : '';
      } else {
        current = overlap > 0 && current ? current.slice(-overlap) + '\n\n' + para : para;
      }
    }
  }
  if (current.length >= MIN_CHUNK_CHARS) chunks.push(current);
  return chunks;
}

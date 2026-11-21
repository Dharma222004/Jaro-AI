// lib/documents/parser.ts
// Extract text from PDF, DOCX, XLSX, CSV, TXT, MD, HTML, JSON files

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ParsedDocument {
  text: string;
  pages: Array<{ pageNumber: number; text: string }>;
  tables: Array<{ title?: string; rows: string[][]; pageNumber?: number }>;
  headings: Array<{ level: number; text: string; pageNumber?: number }>;
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    wordCount: number;
  };
  parsingMethod: string;
  warnings: string[];
}

export async function parseDocument(filePath: string, mimeType: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  const warnings: string[] = [];

  if (ext === '.txt' || ext === '.md') {
    return parsePlainText(filePath, ext);
  }
  if (ext === '.csv') {
    return parseCsv(filePath);
  }
  if (ext === '.json') {
    return parseJson(filePath);
  }
  if (ext === '.html' || ext === '.htm') {
    return parseHtml(filePath);
  }

  // For PDF/DOCX/XLSX: use basic text extraction
  // These require optional packages — gracefully degrade
  if (ext === '.pdf') {
    return parsePdf(filePath, warnings);
  }
  if (ext === '.docx' || ext === '.doc') {
    return parseDocx(filePath, warnings);
  }
  if (ext === '.xlsx' || ext === '.xls') {
    return parseXlsx(filePath, warnings);
  }

  warnings.push(`Unsupported file type: ${ext}. Attempting raw text extraction.`);
  return parsePlainText(filePath, ext, warnings);
}

function parsePlainText(filePath: string, ext: string, existingWarnings: string[] = []): ParsedDocument {
  const text = readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');
  const headings: ParsedDocument['headings'] = [];

  if (ext === '.md') {
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) headings.push({ level: match[1].length, text: match[2].trim() });
    });
  }

  return {
    text, pages: [{ pageNumber: 1, text }], tables: [], headings,
    metadata: { wordCount: text.split(/\s+/).length },
    parsingMethod: 'plain-text', warnings: existingWarnings,
  };
}

function parseCsv(filePath: string): ParsedDocument {
  const text = readFileSync(filePath, 'utf-8');
  const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));

  return {
    text: rows.map(r => r.join('\t')).join('\n'),
    pages: [{ pageNumber: 1, text: text }],
    tables: [{ title: 'CSV Data', rows, pageNumber: 1 }],
    headings: [],
    metadata: { wordCount: text.split(/\s+/).length },
    parsingMethod: 'csv-parser', warnings: [],
  };
}

function parseJson(filePath: string): ParsedDocument {
  const raw = readFileSync(filePath, 'utf-8');
  const text = JSON.stringify(JSON.parse(raw), null, 2);
  return {
    text, pages: [{ pageNumber: 1, text }], tables: [], headings: [],
    metadata: { wordCount: text.split(/\s+/).length },
    parsingMethod: 'json-parser', warnings: [],
  };
}

function parseHtml(filePath: string): ParsedDocument {
  const raw = readFileSync(filePath, 'utf-8');
  // Basic HTML stripping — replace tags with spaces
  const text = raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    text, pages: [{ pageNumber: 1, text }], tables: [], headings: [],
    metadata: { wordCount: text.split(/\s+/).length },
    parsingMethod: 'html-strip', warnings: [],
  };
}

async function loadOptionalModule<T = any>(moduleName: string): Promise<T | null> {
  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await dynamicImport(moduleName);
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

async function parsePdf(filePath: string, warnings: string[]): Promise<ParsedDocument> {
  try {
    const pdfParse = await loadOptionalModule('pdf-parse');
    if (pdfParse) {
      const buffer = readFileSync(filePath);
      const data = await pdfParse(buffer);
      const pages = data.text.split(/\f/).map((pageText: string, i: number) => ({
        pageNumber: i + 1, text: pageText.trim(),
      }));
      return {
        text: data.text, pages,
        tables: [], headings: extractHeadingsFromText(data.text),
        metadata: { title: data.info?.Title, author: data.info?.Author, pageCount: data.numpages, wordCount: data.text.split(/\s+/).length },
        parsingMethod: 'pdf-parse', warnings,
      };
    }
  } catch (err) {
    warnings.push(`PDF parsing failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  warnings.push('pdf-parse package not installed. Install with: npm install pdf-parse. Using raw text fallback.');
  return parsePlainText(filePath, '.pdf', warnings);
}

async function parseDocx(filePath: string, warnings: string[]): Promise<ParsedDocument> {
  try {
    const mammoth = await loadOptionalModule('mammoth');
    if (mammoth) {
      const result = await mammoth.extractRawText({ path: filePath });
      warnings.push(...result.messages.filter((m: { type: string }) => m.type === 'warning').map((m: { message: string }) => m.message));
      return {
        text: result.value, pages: [{ pageNumber: 1, text: result.value }],
        tables: [], headings: extractHeadingsFromText(result.value),
        metadata: { wordCount: result.value.split(/\s+/).length },
        parsingMethod: 'mammoth', warnings,
      };
    }
  } catch (err) {
    warnings.push(`DOCX parsing failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  warnings.push('mammoth package not installed. Install with: npm install mammoth.');
  return parsePlainText(filePath, '.docx', warnings);
}

async function parseXlsx(filePath: string, warnings: string[]): Promise<ParsedDocument> {
  try {
    const XLSX = await loadOptionalModule('xlsx');
    if (XLSX) {
      const workbook = XLSX.readFile(filePath);
      const tables: ParsedDocument['tables'] = [];
      let allText = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
        tables.push({ title: sheetName, rows });
        allText += `\n## Sheet: ${sheetName}\n`;
        allText += rows.map((r: string[]) => r.join('\t')).join('\n');
      }
      return {
        text: allText, pages: [{ pageNumber: 1, text: allText }], tables,
        headings: workbook.SheetNames.map((name: string, i: number) => ({ level: 2, text: name, pageNumber: i + 1 })),
        metadata: { wordCount: allText.split(/\s+/).length },
        parsingMethod: 'xlsx', warnings,
      };
    }
  } catch (err) {
    warnings.push(`XLSX parsing failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  warnings.push('xlsx package not installed. Install with: npm install xlsx.');
  return parsePlainText(filePath, '.xlsx', warnings);
}

function extractHeadingsFromText(text: string): ParsedDocument['headings'] {
  const headings: ParsedDocument['headings'] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.length < 150 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      headings.push({ level: 2, text: trimmed });
    }
  }
  return headings.slice(0, 100);
}

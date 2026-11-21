// lib/documents/embedding.ts
// Local embedding generation using NVIDIA Nemotron or simple TF-IDF fallback

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? '';
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5';

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!NVIDIA_API_KEY) return generateTfidfVector(text);

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({
        input: text.slice(0, 2048),
        model: EMBED_MODEL,
        input_type: 'passage',
        truncate: 'END',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return generateTfidfVector(text);
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? generateTfidfVector(text);
  } catch {
    return generateTfidfVector(text);
  }
}

export async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  if (!NVIDIA_API_KEY) return generateTfidfVector(text);

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NVIDIA_API_KEY}` },
      body: JSON.stringify({
        input: text.slice(0, 512),
        model: EMBED_MODEL,
        input_type: 'query',
        truncate: 'END',
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return generateTfidfVector(text);
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? generateTfidfVector(text);
  } catch {
    return generateTfidfVector(text);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// TF-IDF fallback: creates a sparse vector of token frequencies
function generateTfidfVector(text: string): number[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1;
  // Use a fixed 512-dim hash vector
  const vec = new Array(512).fill(0);
  for (const [token, count] of Object.entries(freq)) {
    // FNV-like hash to map token to vector dimensions
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h = Math.imul(h ^ token.charCodeAt(i), 16777619);
    }
    const idx = Math.abs(h) % 512;
    vec[idx] += count / tokens.length;
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map(v => v / norm) : vec;
}

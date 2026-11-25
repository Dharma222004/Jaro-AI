// lib/security/redactor.ts
// Redacts secrets, credentials, and tokens from logs, errors, and diagnostic payloads.

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/nvapi-[A-Za-z0-9_-]{12,}/g, '[REDACTED_NVIDIA_KEY]'],
  [/tvly-[A-Za-z0-9_-]{10,}/g, '[REDACTED_TAVILY_KEY]'],
  [/gsk_[A-Za-z0-9_-]{12,}/g, '[REDACTED_GROQ_KEY]'],
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]'],
  [/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/(?:api[_-]?key|access[_-]?token|analytics[_-]?token|secret|password|pin|totp)\s*[:=]\s*["']?[^\s"',;}{]+["']?/gi, '[REDACTED_CREDENTIAL]'],
  [/acc_[a-zA-Z0-9_-]+\.[a-f0-9]{16,}/g, '[REDACTED_SESSION_TOKEN]'],
];

const SENSITIVE_KEY_RE = /^(?:apiKey|api_key|secret|token|accessToken|analyticsToken|password|pin|totp|authorization|cookie|set-cookie|nvidiaKey|tavilyKey)$/i;

export function redactSecrets(input: string): string {
  if (!input) return '';
  let out = input;

  // Explicitly scrub any runtime env secrets if set
  const envKeys = [
    process.env.NVIDIA_API_KEY,
    process.env.TAVILY_API_KEY,
    process.env.UPSTOX_ANALYTICS_TOKEN,
    process.env.UPSTOX_ACCESS_TOKEN,
    process.env.UPSTOX_API_SECRET,
    process.env.ANGEL_API_KEY,
    process.env.ANGEL_TOTP_SECRET,
    process.env.MSTOCK_API_KEY,
    process.env.JARO_AUTH_SECRET,
  ];
  for (const secret of envKeys) {
    const trimmed = secret?.trim();
    if (trimmed && trimmed.length >= 8 && !trimmed.startsWith('your_')) {
      out = out.split(trimmed).join('[REDACTED_SECRET]');
    }
  }

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeLogObject<T>(value: T, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecrets(value).slice(0, 1000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeLogObject(item, depth + 1));
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = sanitizeLogObject(val, depth + 1);
      }
    }
    return clean;
  }
  return String(value);
}

export function safePublicError(error: unknown, fallback = 'Operation could not be completed.'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  const cleaned = redactSecrets(raw).replace(/\s+at\s+[^\n]+/g, '').trim();
  if (!cleaned) return fallback;
  if (/sqlite|prisma|enoent|eperm|econnrefused|stack/i.test(cleaned)) {
    return fallback;
  }
  return cleaned.slice(0, 300);
}

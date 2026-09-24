/**
 * Formats a number in Indian financial style (Cr, Lakh, etc.)
 */
export function formatIndianCurrency(
  value: number | string | null | undefined,
  unit?: string
): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);

  if (unit) return `${formatNumber(num)} ${unit}`;
  
  // Auto-format based on magnitude
  const abs = Math.abs(num);
  if (abs >= 10000) {
    return `₹${formatNumber((num / 100).toFixed(0))} Cr`;
  }
  if (abs >= 1) {
    return `₹${formatNumber(num.toFixed(0))} Cr`;
  }
  return `₹${num.toFixed(2)} Cr`;
}

/**
 * Format a number with Indian comma grouping (e.g., 1,24,560)
 */
export function formatNumber(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  
  const fixed = typeof value === 'string' ? value : num.toFixed(0);
  // Indian number format
  return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Format percentage values
 */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  return `${num.toFixed(1)}%`;
}

/**
 * Format multiplier (P/E, EV/EBITDA, etc.)
 */
export function formatMultiple(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  return `${num.toFixed(1)}x`;
}

/**
 * Format a financial metric value with unit
 */
export function formatMetric(
  value: string | number | null,
  unit: string
): string {
  if (value === null || value === undefined || value === '') return 'N/A';

  const unitLower = unit.toLowerCase();
  
  if (unitLower.includes('%')) return `${value}%`;
  if (unitLower.includes('x') || unitLower.includes('multiple')) return `${value}x`;
  if (unitLower.includes('₹') || unitLower.includes('inr') || unitLower.includes('cr')) {
    return `₹${value} Cr`;
  }
  if (unitLower.includes('rs') || unitLower.includes('rupees')) return `₹${value}`;

  return `${value} ${unit}`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Format relative time
 */
export function formatRelativeTime(dateString: string | undefined | null): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateString);
  } catch {
    return dateString ?? '';
  }
}

/**
 * Clean domain from URL
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

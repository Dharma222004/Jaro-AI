'use client';

import { useEffect, useRef, useState } from 'react';
import { Quote, Sparkles } from 'lucide-react';
import { FINANCIAL_QUOTES, type FinancialQuote } from './quotes-data';

interface ThinkingQuotesProps {
  isStreaming: boolean;
  hasContent?: boolean;
}

// Fisher-Yates array shuffle for non-repeating random order
function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function ThinkingQuotes({ isStreaming, hasContent = false }: ThinkingQuotesProps) {
  // Guard: if already finished or has content on first render, do not render at all
  const shouldBeActive = isStreaming && !hasContent;

  const [shuffledQuotes, setShuffledQuotes] = useState<FinancialQuote[]>(() => shuffle(FINANCIAL_QUOTES));
  const [index, setIndex] = useState(0);
  const [fadeState, setFadeState] = useState<'in' | 'out'>('in');
  const [isExiting, setIsExiting] = useState(false);
  const [unmounted, setUnmounted] = useState(!shouldBeActive);

  // References for intervals and timeouts
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle active 6-second rotation cycle
  useEffect(() => {
    if (!shouldBeActive || isExiting) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      return;
    }

    // Every 6000ms: fade out at 5450ms, change quote and fade in at 6000ms
    timerRef.current = setInterval(() => {
      setFadeState('out');

      fadeTimeoutRef.current = setTimeout(() => {
        setIndex((prev) => {
          const next = prev + 1;
          if (next >= shuffledQuotes.length) {
            // Re-shuffle when list completes so user gets infinite random variety
            setShuffledQuotes(shuffle(FINANCIAL_QUOTES));
            return 0;
          }
          return next;
        });
        setFadeState('in');
      }, 550);
    }, 6000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [shouldBeActive, isExiting, shuffledQuotes.length]);

  // Handle smooth exit transition when result arrives or streaming ends
  useEffect(() => {
    if (!shouldBeActive && !unmounted && !isExiting) {
      setIsExiting(true);
      exitTimeoutRef.current = setTimeout(() => {
        setUnmounted(true);
      }, 500);
    }
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, [shouldBeActive, unmounted, isExiting]);

  if (unmounted) return null;

  const quote = shuffledQuotes[index % shuffledQuotes.length];
  if (!quote) return null;

  const tagLabel = quote.category ? `${quote.category.toUpperCase()} · WISDOM` : 'MARKET WISDOM';

  return (
    <div
      className={`thinking-quotes-box ${isExiting ? 'is-exiting' : 'is-active'}`}
      aria-live="polite"
    >
      <div className="thinking-quotes-inner">
        {/* Top Header Row with Category Badge & 6s Progress Bar */}
        <div className="thinking-quotes-meta">
          <div className="thinking-quotes-badge">
            <Quote size={11} className="thinking-quotes-icon" />
            <span>{tagLabel}</span>
          </div>
          <div className="thinking-quotes-progress" title="Quote cycles every 6 seconds">
            <div
              key={`bar-${index}-${fadeState}`}
              className="thinking-quotes-progress-bar"
            />
          </div>
        </div>

        {/* Bold Quote & Attribution with Smooth Fade Animation */}
        <div className={`thinking-quote-content fade-${fadeState}`}>
          <blockquote className="thinking-quote-text">
            “{quote.text}”
          </blockquote>
          <div className="thinking-quote-author-row">
            <span className="thinking-quote-dash">—</span>
            <strong className="thinking-quote-author">
              {quote.author || 'Timeless Investing Principle'}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

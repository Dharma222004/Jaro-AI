'use client';

import React from 'react';
import Image from 'next/image';

export interface ThinkingBulbLogoProps {
  size?: number;
  className?: string;
  variant?: 'gradient' | 'mono' | 'auto';
  pulse?: boolean;
}

/**
 * ThinkingBulbLogo
 * Renders the custom hexagonal lightbulb logo provided by the user.
 * Supports the vibrant orange-to-pink gradient, or monochrome adaptive
 * (white in dark mode, dark navy in light mode).
 */
export function ThinkingBulbLogo({
  size = 16,
  className = '',
  variant = 'gradient',
  pulse = false,
}: ThinkingBulbLogoProps) {
  // Height calculated from aspect ratio 335:464
  const height = Math.round(size * (464 / 335));

  return (
    <span
      className={`thinking-bulb-wrap inline-flex items-center justify-center flex-shrink-0 ${pulse ? 'thinking-bulb-pulse' : ''} ${className}`.trim()}
      style={{
        width: size,
        height,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        verticalAlign: 'middle',
      }}
      aria-hidden="true"
    >
      {/* Gradient version */}
      {(variant === 'gradient' || variant === 'auto') && (
        <img
          src="/images/thinking-bulb-gradient.png"
          alt="Thinking"
          width={size}
          height={height}
          className="thinking-bulb-img thinking-bulb-gradient"
          style={{
            width: `${size}px`,
            height: `${height}px`,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      )}

      {/* Monochrome version (if explicitly requested) */}
      {variant === 'mono' && (
        <>
          <img
            src="/images/thinking-bulb-white.png"
            alt="Thinking"
            width={size}
            height={height}
            className="thinking-bulb-img thinking-bulb-dark-only"
            style={{
              width: `${size}px`,
              height: `${height}px`,
              objectFit: 'contain',
            }}
          />
          <img
            src="/images/thinking-bulb-black.png"
            alt="Thinking"
            width={size}
            height={height}
            className="thinking-bulb-img thinking-bulb-light-only"
            style={{
              width: `${size}px`,
              height: `${height}px`,
              objectFit: 'contain',
            }}
          />
        </>
      )}
    </span>
  );
}

import type { CSSProperties } from 'react';

type BrandLogoVariant = 'primary' | 'sidebar' | 'mobile' | 'compact' | 'hero';

interface JaroLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  style?: CSSProperties;
  animated?: boolean;
}

interface JaroMarkProps {
  className?: string;
  size?: number;
  title?: string;
  animated?: boolean;
}

export function JaroMark({ className = '', size = 38, title, animated = false }: JaroMarkProps) {
  const radius = Math.max(6, Math.round(size * 0.22));

  if (animated) {
    return (
      <span
        className={`jaro-mark-wrapper ${className}`.trim()}
        style={{
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: radius,
          backgroundColor: '#061026',
          flexShrink: 0,
        }}
        title={title || 'Jaro AI'}
      >
        <video
          src="/jaro-institutional-logo.mp4"
          autoPlay
          loop
          muted
          playsInline
          poster="/jaro-institutional-logo-128.png"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </span>
    );
  }

  const src =
    size <= 48
      ? '/jaro-institutional-logo-64.png'
      : size <= 140
        ? '/jaro-institutional-logo-128.png'
        : '/jaro-institutional-logo.png';

  return (
    <span
      className={`jaro-mark-wrapper ${className}`.trim()}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: radius,
        backgroundColor: '#061026',
        flexShrink: 0,
      }}
      title={title || 'Jaro AI'}
    >
      <img
        src={src}
        alt={title || 'Jaro AI'}
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </span>
  );
}

export function JaroLogo({
  variant = 'primary',
  className = '',
  style,
  animated = false,
}: JaroLogoProps) {
  const isCompact = variant === 'compact';
  const isSidebar = variant === 'sidebar';
  const isHero = variant === 'hero';

  const markSize = isHero ? 72 : isSidebar ? 36 : isCompact ? 36 : variant === 'primary' ? 40 : 34;

  return (
    <span className={`brand-lockup brand-lockup--${variant} ${className}`.trim()} style={style}>
      <JaroMark size={markSize} animated={animated || isHero} />
      {!isCompact && (
        <span className="brand-copy">
          <span className="brand-wordmark">
            JARO <span className="brand-wordmark-ai">AI</span>
          </span>
          {variant !== 'mobile' && (
            <span className="brand-descriptor">FINANCE INTELLIGENCE</span>
          )}
        </span>
      )}
    </span>
  );
}

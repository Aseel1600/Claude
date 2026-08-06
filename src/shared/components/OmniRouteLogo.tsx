/**
 * OmniRoute brand logo — burgundy + rose-gold (concept C).
 * One unified endpoint (center hub) connecting N providers (outer nodes).
 *
 * NOTE: This is the simplified in-component variant. It uses solid colors
 * instead of <linearGradient>+url() refs because Next.js 16 + Turbopack has
 * been miscompiling inline `url(#${useId()})` references — the failing
 * `fill` then fell back to `currentColor` which the dashboard theme paints
 * as the old `#E54D5E` brand red. The full-color version with gradients
 * is in public/favicon.svg, public/icon-192.svg, electron/assets/icon.png,
 * etc. — see `_brand-concepts/final/logo-simple.svg` for the static SVG
 * source this component mirrors.
 */
type OmniRouteLogoProps = {
  size?: number;
  className?: string;
};

export default function OmniRouteLogo({ size = 20, className = "" }: OmniRouteLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="OmniRoute"
      shapeRendering="geometricPrecision"
    >
      {/* 圆角矩形底 — solid burgundy (matches #7F1D1D lower-right of original gradient) */}
      <rect width="32" height="32" rx="7" fill="#7F1D1D" />
      {/* 8 条放射连接线 */}
      <g stroke="#E0BFB8" strokeWidth="0.6" strokeLinecap="round" opacity="0.55">
        <line x1="16" y1="16" x2="16" y2="4" />
        <line x1="16" y1="16" x2="24" y2="6" />
        <line x1="16" y1="16" x2="28" y2="12" />
        <line x1="16" y1="16" x2="26" y2="22" />
        <line x1="16" y1="16" x2="16" y2="28" />
        <line x1="16" y1="16" x2="6" y2="22" />
        <line x1="16" y1="16" x2="4" y2="12" />
        <line x1="16" y1="16" x2="8" y2="6" />
      </g>
      {/* 8 个外围 provider 节点(不同大小) */}
      <circle cx="16" cy="4" r="1.3" fill="#F5EBE0" />
      <circle cx="24" cy="6" r="1.7" fill="#F5EBE0" />
      <circle cx="28" cy="12" r="1.6" fill="#F5EBE0" />
      <circle cx="26" cy="22" r="2" fill="#F5EBE0" />
      <circle cx="16" cy="28" r="1.3" fill="#F5EBE0" />
      <circle cx="6" cy="22" r="1.7" fill="#F5EBE0" />
      <circle cx="4" cy="12" r="1.5" fill="#F5EBE0" />
      <circle cx="8" cy="6" r="1.4" fill="#F5EBE0" />
      {/* 中心端点 — solid deep red (#991B1B) */}
      <circle cx="16" cy="16" r="7" fill="#991B1B" />
    </svg>
  );
}

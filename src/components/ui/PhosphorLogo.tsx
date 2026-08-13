import React from 'react';

interface PhosphorLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
  style?: React.CSSProperties;
}

export const PhosphorLogo: React.FC<PhosphorLogoProps> = ({
  size = 24,
  className = '',
  animated = false,
  style = {}
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={Math.round(size * (46 / 48))}
      viewBox="0 0 48 46"
      fill="none"
      className={`phosphor-logo-svg ${animated ? 'animated-glow' : ''} ${className}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        filter: 'drop-shadow(0 0 6px rgba(134, 59, 255, 0.6))',
        ...style
      }}
    >
      <path
        fill="#863bff"
        d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
      />
      <mask id="phosphor-mask" width="48" height="46" x="0" y="0" maskUnits="userSpaceOnUse">
        <path
          fill="#fff"
          d="M25.842 44.938c-.664.844-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.183c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.498 0-3.579-1.842-3.579H1.133c-.92 0-1.456-1.04-.92-1.787L9.91.473c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.578 1.842 3.578h11.377c.943 0 1.473 1.088.89 1.832L25.843 44.94z"
        />
      </mask>
      <g mask="url(#phosphor-mask)">
        <ellipse
          cx="24"
          cy="20"
          rx="18"
          ry="14"
          fill="#47bfff"
          opacity="0.6"
          filter="blur(8px)"
        />
        <ellipse
          cx="16"
          cy="28"
          rx="10"
          ry="18"
          fill="#ede6ff"
          opacity="0.8"
          filter="blur(5px)"
        />
        <ellipse
          cx="34"
          cy="12"
          rx="12"
          ry="10"
          fill="#00e5ff"
          opacity="0.7"
          filter="blur(6px)"
        />
        <path
          d="M10 2l18 0l-8 12l14 0l-14 26l0 -12l-10 0z"
          fill="#ffffff"
          opacity="0.25"
        />
      </g>
    </svg>
  );
};

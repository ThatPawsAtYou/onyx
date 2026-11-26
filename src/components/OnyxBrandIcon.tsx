import React, { useId } from 'react';

interface OnyxBrandIconProps {
  className?: string;
}

/**
 * Exact Onyx brand icon matching src-tauri/icons/icon.png & public/onyx-icon.svg:
 * Deep obsidian squircle container with subtle metallic rim and 4-facet 3D octahedron prism.
 */
export const OnyxBrandIcon: React.FC<OnyxBrandIconProps> = ({
  className = 'h-10 w-10',
}) => {
  const uid = useId().replace(/:/g, '');

  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Onyx Logo"
    >
      <defs>
        <linearGradient
          id={`bgGrad-${uid}`}
          x1="512"
          y1="64"
          x2="512"
          y2="960"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#1E1E24" />
          <stop offset="45%" stopColor="#0D0D10" />
          <stop offset="100%" stopColor="#050507" />
        </linearGradient>
        <linearGradient
          id={`rimGrad-${uid}`}
          x1="512"
          y1="64"
          x2="512"
          y2="960"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.38" />
          <stop offset="30%" stopColor="#FFFFFF" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.04" />
        </linearGradient>
        <radialGradient id={`topGlow-${uid}`} cx="50%" cy="12%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`facetTopLeft-${uid}`}
          x1="340"
          y1="240"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#D4D4D8" />
        </linearGradient>
        <linearGradient
          id={`facetTopRight-${uid}`}
          x1="684"
          y1="240"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A1A1AA" />
          <stop offset="100%" stopColor="#52525B" />
        </linearGradient>
        <linearGradient
          id={`facetBottomLeft-${uid}`}
          x1="320"
          y1="512"
          x2="512"
          y2="790"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A1A1AA" />
          <stop offset="100%" stopColor="#71717A" />
        </linearGradient>
        <linearGradient
          id={`facetBottomRight-${uid}`}
          x1="704"
          y1="512"
          x2="512"
          y2="790"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#3F3F46" />
          <stop offset="100%" stopColor="#18181B" />
        </linearGradient>
      </defs>

      {/* Squircle Base */}
      <rect
        x="40"
        y="40"
        width="944"
        height="944"
        rx="224"
        fill={`url(#bgGrad-${uid})`}
      />
      <rect
        x="40"
        y="40"
        width="944"
        height="944"
        rx="224"
        fill={`url(#topGlow-${uid})`}
      />
      <rect
        x="52"
        y="52"
        width="920"
        height="920"
        rx="214"
        stroke={`url(#rimGrad-${uid})`}
        strokeWidth="18"
      />

      {/* Faceted Onyx Octahedron / Prism */}
      <g>
        <polygon
          points="512,196 268,512 512,462"
          fill={`url(#facetTopLeft-${uid})`}
        />
        <polygon
          points="512,196 756,512 512,462"
          fill={`url(#facetTopRight-${uid})`}
        />
        <polygon
          points="268,512 512,828 512,462"
          fill={`url(#facetBottomLeft-${uid})`}
        />
        <polygon
          points="756,512 512,828 512,462"
          fill={`url(#facetBottomRight-${uid})`}
        />
        <line
          x1="512"
          y1="196"
          x2="512"
          y2="828"
          stroke="#FFFFFF"
          strokeOpacity="0.45"
          strokeWidth="10"
        />
        <line
          x1="268"
          y1="512"
          x2="512"
          y2="462"
          stroke="#FFFFFF"
          strokeOpacity="0.6"
          strokeWidth="10"
        />
        <line
          x1="512"
          y1="462"
          x2="756"
          y2="512"
          stroke="#FFFFFF"
          strokeOpacity="0.22"
          strokeWidth="8"
        />
      </g>
    </svg>
  );
};

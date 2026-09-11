import React from "react";

export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="mark-blue-grad" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7091e5" />
          <stop offset="1" stopColor="#316bff" />
        </linearGradient>
      </defs>
      <line x1="7" y1="13" x2="19" y2="13" stroke="url(#mark-blue-grad)" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="7" cy="13" r="5" fill="#316bff" />
      <circle cx="19" cy="13" r="5" fill="var(--color-canvas)" stroke="#316bff" strokeWidth="2.6" />
    </svg>
  );
}

export default Mark;

/**
 * Inline SVG icon set — 12px, 1.5 stroke, currentColor. No emojis anywhere.
 */
const PATHS: Record<string, React.ReactNode> = {
  branch: (
    <>
      <circle cx="4" cy="4" r="1.8" />
      <circle cx="4" cy="12" r="1.8" />
      <circle cx="12" cy="5.5" r="1.8" />
      <path d="M4 5.8v4.4M12 7.3c0 2.5-3.5 2.2-6 3" />
    </>
  ),
  lock: (
    <>
      <rect x="3.2" y="7" width="9.6" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2.2 14.5 13.5H1.5Z" />
      <path d="M8 6.5v3.2" />
      <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  block: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M3.9 3.9l8.2 8.2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
    </>
  ),
  broadcast: (
    <>
      <path d="M3 6.5v3h2.5L10 13V3L5.5 6.5Z" />
      <path d="M12 5.5a4 4 0 0 1 0 5" />
    </>
  ),
  commit: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.5v4M8 10.5v4" />
    </>
  ),
  push: (
    <>
      <path d="M8 13V4M4.5 7.5 8 4l3.5 3.5" />
      <path d="M3 2.5h10" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1" />
      <path d="m2.5 4.5 5.5 4.5 5.5-4.5" />
    </>
  ),
  merge: (
    <>
      <circle cx="4" cy="12" r="1.8" />
      <circle cx="4" cy="4" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M4 5.8c0 4 4 6.2 6.2 6.2M4 5.8v4.4" />
    </>
  ),
  check: <path d="m3 8.5 3.2 3L13 4.5" />,
  cross: <path d="m4 4 8 8M12 4l-8 8" />,
  bell: (
    <>
      <path d="M8 2.5a3.8 3.8 0 0 1 3.8 3.8c0 3 1.2 4 1.2 4H3s1.2-1 1.2-4A3.8 3.8 0 0 1 8 2.5Z" />
      <path d="M6.8 12.7a1.3 1.3 0 0 0 2.4 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M4.5 4.8A3.8 3.8 0 0 1 11.8 6.3c0 3 1.2 4 1.2 4H5" />
      <path d="M6.8 12.7a1.3 1.3 0 0 0 2.4 0M2.5 2.5l11 11" />
    </>
  ),
  file: (
    <>
      <path d="M4 1.8h5l3 3v9.4H4Z" />
      <path d="M9 1.8v3h3" />
    </>
  ),
  chevron: <path d="m6 3.5 4.5 4.5L6 12.5" />,
  record: <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />,
  download: (
    <>
      <path d="M8 2.5v7M4.5 6.5 8 10l3.5-3.5" />
      <path d="M3 13.5h10" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </>
  ),
  swap: (
    <>
      <path d="M11 3.5 13.5 6H4M5 12.5 2.5 10H12" />
    </>
  ),
  eye: (
    <>
      <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
};

export function Icon({
  name,
  size = 12,
  className = "",
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block flex-none align-[-0.12em] ${className}`}
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

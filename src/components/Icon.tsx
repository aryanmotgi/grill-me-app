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
  inbox: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M2 9h3.2l.8 1.6h4l.8-1.6H14" />
    </>
  ),
  note: (
    <>
      <path d="M4 2h6l2.5 2.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M5.5 7h5M5.5 9.5h3" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </>
  ),
  panelRight: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M10 2.5v11" />
    </>
  ),
  bolt: <path d="M9 1.8 3.8 9h3.7L7 14.2 12.2 7H8.5Z" />,
  upload: (
    <>
      <path d="M8 10.5V3M5 6l3-3 3 3" />
      <path d="M3 10v2.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10" />
    </>
  ),
  bulb: (
    <>
      <path d="M6 11.5h4M6.5 13.8h3" />
      <path d="M8 2a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6V11h3v-.2c0-.6.4-1.2.9-1.6A4 4 0 0 0 8 2Z" />
    </>
  ),
  up: <path d="M8 13V3.5M4 7.5l4-4 4 4" />,
  doc: (
    <>
      <path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z" />
      <path d="M9 1.8V5h3.5" />
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
  grip: (
    <>
      <circle cx="6" cy="4" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
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
  team: (
    <>
      <circle cx="5.8" cy="6" r="2.1" />
      <path d="M2.3 13c0-2.1 1.6-3.4 3.5-3.4S9.3 10.9 9.3 13" />
      <circle cx="11.3" cy="6.6" r="1.7" />
      <path d="M10.4 8.5c2 0 3.3 1.3 3.3 3.1" />
    </>
  ),
  palette: (
    <>
      <path d="M8 2.2a5.8 5.8 0 0 0 0 11.6c1 0 1.6-.8 1.6-1.7 0-.9-.7-1.3-.7-2 0-.6.5-1 1.1-1H12a2 2 0 0 0 2-2C14 4.4 11.3 2.2 8 2.2Z" />
      <circle cx="5.4" cy="7" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="7" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="m4.6 6.4 2 2-2 2M8.4 10.6h3" />
    </>
  ),
  layout: (
    <>
      <rect x="2.3" y="3" width="11.4" height="10" rx="1" />
      <path d="M6.4 3v10" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.8" y="4.4" width="12.4" height="7.2" rx="1" />
      <path d="M4.4 7h.01M6.6 7h.01M8.8 7h.01M11 7h.01M5 9.4h6" />
    </>
  ),
  folder: (
    <>
      <path d="M2 4.4h3.8L7 6h6.5a.5.5 0 0 1 .5.5v5.6a.4.4 0 0 1-.4.4H2.4a.4.4 0 0 1-.4-.4Z" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <circle cx="8" cy="8" r="2.3" />
      <path d="M3.9 3.9 6.4 6.4M12.1 3.9 9.6 6.4M3.9 12.1 6.4 9.6M12.1 12.1 9.6 9.6" />
    </>
  ),
  space: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <ellipse cx="8" cy="8" rx="6.2" ry="2.6" transform="rotate(-24 8 8)" />
      <circle cx="13.2" cy="4.6" r="0.6" />
    </>
  ),
  spark: (
    <>
      <path d="M8 2.2c.5 2.6 1.2 3.3 3.8 3.8-2.6.5-3.3 1.2-3.8 3.8-.5-2.6-1.2-3.3-3.8-3.8C6.8 5.5 7.5 4.8 8 2.2Z" />
      <path d="M12.2 9.6c.25 1.3.6 1.65 1.9 1.9-1.3.25-1.65.6-1.9 1.9-.25-1.3-.6-1.65-1.9-1.9 1.3-.25 1.65-.6 1.9-1.9Z" />
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

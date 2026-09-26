// ---------------------------------------------------------------------------
// Inline brand marks for each agent CLI, like Monocode's model logos on its
// session cards. Pure SVG (no network / no CSP issue), drawn to read at 12–16px.
// Each keeps a muted brand tint that still sits inside the graphite palette.
// ---------------------------------------------------------------------------

type Agent = "claude" | "cursor" | "codex" | string;

const TINT: Record<string, string> = {
  claude: "#c88a6a", // muted Anthropic clay
  cursor: "#c9ccd2", // near-white
  codex: "#7fb59a", // muted OpenAI green
};

export function AgentLogo({ agent, size = 14 }: { agent: Agent; size?: number }) {
  const color = TINT[agent] ?? "var(--dim)";
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const };

  if (agent === "cursor") {
    // angular cursor/caret mark
    return (
      <svg {...common}>
        <path d="M5 3 L19 11 L12.5 12.5 L11 19 Z" fill={color} opacity="0.92" />
      </svg>
    );
  }
  if (agent === "codex") {
    // OpenAI-style six-lobe knot, simplified to a ring of petals
    return (
      <svg {...common}>
        <g fill="none" stroke={color} strokeWidth="1.7" opacity="0.9">
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 5.5 V12 M12 12 L17.6 15.2 M12 12 L6.4 15.2" strokeLinecap="round" />
        </g>
      </svg>
    );
  }
  // claude (default): Anthropic starburst
  return (
    <svg {...common}>
      <g stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.92">
        <path d="M12 3.5 V20.5 M3.5 12 H20.5 M6 6 L18 18 M18 6 L6 18" />
      </g>
    </svg>
  );
}

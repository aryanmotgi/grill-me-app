/* themes.cjs — palette + type tokens. Every visual reads these, so swapping
 * a theme recolors every diagram in the deck with no edit to any slide. */
module.exports = {
  carbon: {
    name: 'Carbon', title: 'DealGhost — Carbon',
    bg1: '#0D0D0F', bg2: '#16161A', ink: '#F2F0EB', muted: '#8E8E98',
    accent: '#C6F24E', onAccent: '#0D0D0F', onAccentMuted: 'rgba(13,13,15,0.66)', line: '#2A2A31', risk: '#FF7A66',
    disp: "'Space Grotesk', Verdana, sans-serif",
    body: "'Space Grotesk', Verdana, sans-serif",
    eyeF: "'JetBrains Mono', 'Courier New', monospace",
    eyeTrack: '4px', eyeSize: 24, dispW: 500, cardBg: '#16161A', cardR: '20px',
    h1: 132, h2: 92, h3: 36, p: 34, small: 28,
    faces: {
      'space-grotesk': { family: 'Space Grotesk', href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap' },
      'jetbrains-mono': { family: 'JetBrains Mono', href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap' },
    },
  },
  press: {
    name: 'Press', title: 'DealGhost — Press',
    bg1: '#F7F4EE', bg2: '#ECE6DA', ink: '#161512', muted: '#6B665C',
    accent: '#B8402A', onAccent: '#F7F4EE', onAccentMuted: 'rgba(247,244,238,0.80)', line: '#D6CEBE', risk: '#8C2F1C',
    disp: "'Playfair Display', Georgia, serif",
    body: "'Public Sans', Verdana, sans-serif",
    eyeF: "'Public Sans', Verdana, sans-serif",
    eyeTrack: '5px', eyeSize: 24, dispW: 500, cardBg: '#FFFDF8', cardR: '4px',
    h1: 124, h2: 88, h3: 36, p: 34, small: 28,
    faces: {
      'playfair-display': { family: 'Playfair Display', href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Public+Sans:wght@300;400;600&display=swap' },
      'public-sans': { family: 'Public Sans', href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Public+Sans:wght@300;400;600&display=swap' },
    },
  },
  signal: {
    name: 'Signal', title: 'DealGhost — Signal',
    bg1: '#171A3A', bg2: '#0E1029', ink: '#FAF9F6', muted: '#9296C4',
    accent: '#FFB020', onAccent: '#171A3A', onAccentMuted: 'rgba(23,26,58,0.68)', line: '#2E3364', risk: '#FF8A7A',
    disp: "'Oswald', 'Trebuchet MS', sans-serif",
    body: "'DM Sans', Verdana, sans-serif",
    eyeF: "'DM Sans', Verdana, sans-serif",
    eyeTrack: '6px', eyeSize: 24, dispW: 500, cardBg: '#1F2350', cardR: '12px',
    h1: 156, h2: 110, h3: 38, p: 34, small: 28,
    faces: {
      'oswald': { family: 'Oswald', href: 'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600&family=DM+Sans:wght@400;500;700&display=swap' },
      'dm-sans': { family: 'DM Sans', href: 'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600&family=DM+Sans:wght@400;500;700&display=swap' },
    },
  },
};

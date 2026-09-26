// ---------------------------------------------------------------------------
// Composer autocomplete parsing. Pure so it unit-tests without a DOM.
// ---------------------------------------------------------------------------

export interface ComposerToken {
  kind: "/" | "@";
  /** text after the trigger char, up to the caret */
  query: string;
  /** index of the trigger char in the text */
  start: number;
}

/**
 * The active autocomplete trigger at the caret, or null. A "/" only triggers at
 * the very start of the input or right after whitespace (so a path like a/b
 * doesn't pop the command menu); "@" triggers anywhere in a word.
 */
export function activeToken(text: string, caret: number): ComposerToken | null {
  if (caret < 0 || caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && !/\s/.test(text[i])) i--;
  const tokenStart = i + 1;
  const token = text.slice(tokenStart, caret);
  if (token.startsWith("/") && (tokenStart === 0 || /\s/.test(text[tokenStart - 1]))) {
    return { kind: "/", query: token.slice(1), start: tokenStart };
  }
  if (token.startsWith("@")) {
    return { kind: "@", query: token.slice(1), start: tokenStart };
  }
  return null;
}

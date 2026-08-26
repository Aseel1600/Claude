/**
 * Markdown boundary buffering for streaming text deltas.
 *
 * Upstream SSE chunks can split in the middle of Markdown tokens such as
 * fenced code blocks (```language) or bold markers (**). Emitting those
 * partial tokens as separate text_delta events causes clients to render the
 * stream with broken Markdown until the next delta arrives.
 *
 * This helper identifies a trailing suffix that is an *incomplete* Markdown
 * boundary token and defers it to the next chunk so the token is emitted in
 * one piece.
 *
 * Rules (all bounded by MAX_HOLD_CHARS):
 *   - 1-2 trailing backticks in an "opener" context (start, whitespace, or
 *     punctuation before the run) are held.
 *   - Three trailing backticks followed by a non-empty fence info string are
 *     held; plain "```" is emitted so a closing fence is not accidentally
 *     merged with following text.
 *   - A single trailing asterisk in an opener context is held. We never hold
 *     part of a "**" run, and we never hold when preceded by an alphanumeric
 *     character (which indicates a closing delimiter).
 */

const MAX_HOLD_CHARS = 32;

function isOpenerContext(text: string, suffixStart: number): boolean {
  if (suffixStart <= 0) return true;
  const prev = text[suffixStart - 1];
  // Alphanumeric preceding characters usually mean the delimiter is closing
  // (e.g. "`code`" or "**bold**"), so do not hold those suffixes.
  return !/[A-Za-z0-9_]/.test(prev);
}

export function splitMarkdownBoundary(text: string): { emit: string; hold: string } {
  if (!text) return { emit: "", hold: "" };

  // 1) Incomplete fenced code block opener or inline code opener:
  //    - ` or `` (incomplete delimiter)
  //    - `code or ``code (incomplete inline code run)
  //    - ```python (fence delimiter + partial info string)
  //    Do NOT hold plain "```" by itself to avoid gluing a closing fence to
  //    the next line of normal text.
  const fenceMatch = text.match(/(?<!`)(`{1,2}[A-Za-z0-9_+#-]*|`{3,}[A-Za-z0-9_+#-]+)$/);
  if (fenceMatch) {
    const suffix = fenceMatch[0];
    if (suffix.length <= MAX_HOLD_CHARS && isOpenerContext(text, text.length - suffix.length)) {
      return { emit: text.slice(0, -suffix.length), hold: suffix };
    }
  }

  // 2) Incomplete emphasis/bold opener: 1 to 3 asterisks in an opener context.
  const emphMatch = text.match(/(?<!\*)\*{1,3}$/);
  if (emphMatch) {
    const suffix = emphMatch[0];
    if (isOpenerContext(text, text.length - suffix.length)) {
      return { emit: text.slice(0, -suffix.length), hold: suffix };
    }
  }

  return { emit: text, hold: "" };
}

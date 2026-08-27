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
 * Rules (held suffixes are bounded by MAX_HOLD_CHARS):
 *   - 1-2 trailing backticks in an "opener" context (start, whitespace, or
 *     punctuation before the run) are held.
 *   - Three trailing backticks followed by a non-empty fence info string are
 *     held; plain "```" is emitted so a closing fence is not accidentally
 *     merged with following text.
 *   - One to three trailing asterisks in an opener context are held. We never
 *     hold when preceded by an alphanumeric character (which indicates a
 *     closing delimiter).
 */

const MAX_HOLD_CHARS = 32;

function isOpenerContext(text: string, suffixStart: number): boolean {
  if (suffixStart <= 0) return true;
  const prev = text[suffixStart - 1];
  // Alphanumeric preceding characters usually mean the delimiter is closing
  // (e.g. "`code`" or "**bold**"), so do not hold those suffixes.
  return !/[A-Za-z0-9_]/.test(prev);
}

function scanBacktickRun(text: string, initialRun: number): number {
  let openRun = initialRun;
  for (let index = 0; index < text.length;) {
    if (text[index] !== "`") {
      index++;
      continue;
    }
    let escapes = 0;
    for (
      let escapeIndex = index - 1;
      escapeIndex >= 0 && text[escapeIndex] === "\\";
      escapeIndex--
    ) {
      escapes++;
    }
    if (escapes % 2 === 1) {
      index++;
      continue;
    }
    let runEnd = index + 1;
    while (runEnd < text.length && text[runEnd] === "`") runEnd++;
    const runLength = runEnd - index;
    if (openRun === 0) openRun = runLength;
    else if (openRun === runLength) openRun = 0;
    index = runEnd;
  }
  return openRun;
}

export function splitMarkdownBoundary(
  text: string,
  priorBacktickRun = 0
): { emit: string; hold: string; backtickRun?: number } {
  if (!text) return { emit: "", hold: "" };

  // 1) Incomplete fenced code block opener or inline code opener:
  //    - ` or `` (incomplete delimiter)
  //    - `code or ``code (incomplete inline code run)
  //    - ```info (fence delimiter + partial info string; any non-backtick,
  //      non-line-ending CommonMark info character)
  //    Do NOT hold plain "```" by itself to avoid gluing a closing fence to
  //    the next line of normal text.
  const fenceMatch = text.match(/(?<!`)(`{1,2}[A-Za-z0-9_+#-]*|`{3,}[^`\r\n]+)$/);
  if (fenceMatch) {
    const suffix = fenceMatch[0];
    const suffixStart = text.length - suffix.length;
    const runLength = suffix.match(/^`+/)?.[0].length ?? 0;
    const openRun = scanBacktickRun(text.slice(0, suffixStart), priorBacktickRun);
    const closesKnownRun = openRun === runLength;
    const mayCompleteKnownRun = openRun > runLength;
    if (
      suffix.length <= MAX_HOLD_CHARS &&
      !closesKnownRun &&
      (mayCompleteKnownRun || isOpenerContext(text, suffixStart))
    ) {
      const emit = text.slice(0, -suffix.length);
      const backtickRun = scanBacktickRun(emit, priorBacktickRun);
      return backtickRun ? { emit, hold: suffix, backtickRun } : { emit, hold: suffix };
    }
  }

  // 2) Incomplete emphasis/bold opener: 1 to 3 asterisks in an opener context.
  const emphMatch = text.match(/(?<!\*)\*{1,3}$/);
  if (emphMatch) {
    const suffix = emphMatch[0];
    if (isOpenerContext(text, text.length - suffix.length)) {
      const emit = text.slice(0, -suffix.length);
      const backtickRun = scanBacktickRun(emit, priorBacktickRun);
      return backtickRun ? { emit, hold: suffix, backtickRun } : { emit, hold: suffix };
    }
  }

  const backtickRun = scanBacktickRun(text, priorBacktickRun);
  return backtickRun ? { emit: text, hold: "", backtickRun } : { emit: text, hold: "" };
}

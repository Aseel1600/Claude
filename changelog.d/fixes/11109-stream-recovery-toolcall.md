Scope: fix(stream): resume stream recovery after a completed tool call

OmniRoute's mid-stream continuation can re-request a truncated OpenAI-compatible
stream and stitch only the missing text suffix. Previously, any tool call seen
in the stream — complete or still streaming — blocked recovery entirely, because
`finish_reason: "tool_calls"` was treated as a general terminal marker, so the
new "in flight" distinction it introduced could never actually differ from it.

A tool call is now tracked separately from the general terminal marker: it is
in flight only while its own `finish_reason: "tool_calls"` has not appeared yet
(continuation stays blocked there, since the continuation only de-duplicates
the leading text seam — a partial `tool_calls` argument would be replayed
verbatim). Once that finish reason closes the call, a later truncation of
trailing text is recoverable, matching how the client actually behaves: the
call was already fully delivered.

([#0000](https://github.com/diegosouzapw/OmniRoute/pull/11109))

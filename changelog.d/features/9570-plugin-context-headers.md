feat(plugins): expose client request headers in plugin onRequest/onResponse context (#9570)

Adds an optional `headers` field to `PluginContext` so plugin hooks can
read request-scoped HTTP headers (trace ids, correlation ids, session markers)
sent by the client. The `clientRawRequest.headers` value is plumbed through
both `runPluginOnRequestHook` and `runPluginOnResponseHook` at the 3 call sites
in `handleChatCore()`.

No breaking changes — the field is optional and all existing callers
are unaffected.

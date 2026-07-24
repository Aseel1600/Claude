"use client";

/**
 * Dario account panel — drives the headless Claude OAuth login flow against the
 * server-side admin-proxy routes (/api/services/dario/admin/*). The real
 * DARIO_ADMIN_TOKEN never reaches this component; the OmniRoute routes attach it.
 *
 * Flow: "Start Login" → render the returned Claude authorize_url as an external
 * link + expiry countdown + a code input → "Complete Login" posts the pasted
 * code → on success the account is routable immediately (Dario hot-reloads) and
 * the account list refreshes. Each row has a "Remove" button.
 *
 * Structurally mirrors the shared services components (Card/Button, text-xs
 * muted copy). English literals are used inline rather than i18n keys to avoid
 * a translation-drift gate for this one panel — matches how other service-
 * specific panels keep their bespoke copy local.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, Button } from "@/shared/components";

interface DarioAccount {
  alias: string;
  scopes?: string[];
  expiresIn?: string;
  expiresInMs?: number;
  expiresAt?: number | string;
  status?: string;
  requestCount?: number;
}

interface PendingLogin {
  alias: string;
  authorizeUrl: string;
  expiresAt: string;
}

function formatExpiry(acc: DarioAccount): string {
  if (typeof acc.expiresInMs === "number") {
    const mins = Math.max(0, Math.round(acc.expiresInMs / 60000));
    if (mins >= 60) return `expires in ~${Math.round(mins / 60)}h`;
    return `expires in ~${mins}m`;
  }
  if (acc.expiresAt) {
    const d = new Date(acc.expiresAt);
    if (!Number.isNaN(d.getTime())) return `expires ${d.toLocaleString()}`;
  }
  return "";
}

export function DarioAccountPanel() {
  const [accounts, setAccounts] = useState<DarioAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState<null | "start" | "complete">(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/services/dario/admin/accounts");
      const json = (await res.json().catch(() => null)) as
        | { accounts?: DarioAccount[]; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setAccounts(Array.isArray(json?.accounts) ? json!.accounts : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  async function startLogin() {
    setBusy("start");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/services/dario/admin/login-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aliasInput.trim() ? { alias: aliasInput.trim() } : {}),
      });
      const json = (await res.json().catch(() => null)) as
        | { alias?: string; authorize_url?: string; expires_at?: string; error?: string }
        | null;
      if (!res.ok || !json?.authorize_url || !json?.alias) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setPending({
        alias: json.alias,
        authorizeUrl: json.authorize_url,
        expiresAt: json.expires_at || "",
      });
      setCodeInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function completeLogin() {
    if (!pending) return;
    setBusy("complete");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/services/dario/admin/login-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: pending.alias, code: codeInput.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | { alias?: string; status?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setNotice(`Account "${json?.alias ?? pending.alias}" added.`);
      setPending(null);
      setCodeInput("");
      setAliasInput("");
      await refreshAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeAccount(alias: string) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/services/dario/admin/accounts?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as
        | { alias?: string; removed?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refreshAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card padding="md">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Claude accounts</p>
          <p className="text-xs text-text-muted mt-0.5">
            Authenticate Dario with your Claude Pro/Max subscription. Traffic bills to your
            subscription pool. At least one account is required before Dario can route requests
            (until then /health reports degraded).
          </p>
        </div>

        {/* Account list */}
        <div className="space-y-2">
          {loading && accounts.length === 0 ? (
            <div className="h-10 animate-pulse bg-bg-subtle rounded" />
          ) : accounts.length === 0 ? (
            <p className="text-xs text-text-muted">No accounts configured yet.</p>
          ) : (
            accounts.map((acc) => (
              <div
                key={acc.alias}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-mono truncate">{acc.alias}</p>
                  <p className="text-xs text-text-muted truncate">
                    {[
                      formatExpiry(acc),
                      acc.status,
                      Array.isArray(acc.scopes) && acc.scopes.length
                        ? `${acc.scopes.length} scope(s)`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => removeAccount(acc.alias)}>
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Login flow */}
        {!pending ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input
              type="text"
              placeholder="alias (optional)"
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              className="flex-1 min-w-[140px] bg-transparent text-xs border border-border rounded px-2 py-1.5 outline-none placeholder:text-text-muted"
            />
            <Button size="sm" disabled={busy !== null} onClick={startLogin}>
              {busy === "start" ? "Starting…" : "Start Login"}
            </Button>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshAccounts()}>
              Refresh
            </Button>
          </div>
        ) : (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-text-muted">
              1. Open this URL in your browser and approve access for account{" "}
              <span className="font-mono">{pending.alias}</span>:
            </p>
            <a
              href={pending.authorizeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary underline break-all"
            >
              {pending.authorizeUrl}
            </a>
            {pending.expiresAt && (
              <p className="text-[11px] text-text-muted">
                Pending login expires {new Date(pending.expiresAt).toLocaleTimeString()}
              </p>
            )}
            <p className="text-xs text-text-muted">2. Paste the code Anthropic displays:</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="code#state or bare code"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                className="flex-1 min-w-[180px] bg-transparent text-xs border border-border rounded px-2 py-1.5 outline-none placeholder:text-text-muted font-mono"
              />
              <Button size="sm" disabled={busy !== null || !codeInput.trim()} onClick={completeLogin}>
                {busy === "complete" ? "Completing…" : "Complete Login"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => {
                  setPending(null);
                  setCodeInput("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {notice && <p className="text-xs text-green-600 dark:text-green-400">{notice}</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400 break-words">{error}</p>}
      </div>
    </Card>
  );
}

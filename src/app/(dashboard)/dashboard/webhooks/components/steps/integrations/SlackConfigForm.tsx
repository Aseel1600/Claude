"use client";

import { useEffect, useState } from "react";
import { AppleField, AppleInput } from "@/shared/components";

export interface SlackConfig {
  webhookUrl: string;
}

interface SlackConfigFormProps {
  value: SlackConfig;
  onChange: (v: SlackConfig) => void;
  t: (key: string) => string;
}

type UrlState = "idle" | "checking" | "ok" | "blocked" | "invalid";

export function SlackConfigForm({ value, onChange, t }: SlackConfigFormProps) {
  const [urlState, setUrlState] = useState<UrlState>("idle");

  useEffect(() => {
    const url = value.webhookUrl.trim();
    const controller = new AbortController();
    const delay = url ? 600 : 0;
    const timer = setTimeout(async () => {
      if (!url) {
        setUrlState("idle");
        return;
      }
      setUrlState("checking");
      try {
        const res = await fetch("/api/webhooks/validate-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        setUrlState(data.valid ? "ok" : data.reason === "blocked_private" ? "blocked" : "invalid");
      } catch {
        if (!controller.signal.aborted) setUrlState("invalid");
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value.webhookUrl]);

  const urlHint =
    urlState === "checking"
      ? t("validateUrl.checking")
      : urlState === "ok"
        ? t("validateUrl.ok")
        : urlState === "blocked"
          ? t("validateUrl.blockedPrivate")
          : urlState === "invalid" && value.webhookUrl.trim()
            ? t("validateUrl.invalidUrl")
            : "";

  return (
    <div className="space-y-4">
      <AppleField
        id="slack-webhook-url"
        label={t("slack.webhookUrl")}
        error={urlState === "blocked" || urlState === "invalid" ? urlHint : undefined}
        hint={urlState === "ok" || urlState === "checking" ? urlHint : t("slack.webhookUrlHint")}
      >
        <AppleInput
          id="slack-webhook-url"
          value={value.webhookUrl}
          onChange={(e) => onChange({ webhookUrl: e.target.value })}
          placeholder={t("slack.webhookUrlPlaceholder")}
        />
      </AppleField>
      <details className="rounded-lg border border-border bg-sidebar p-3">
        <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-text-main">
          {t("slack.tutorial")}
        </summary>
        <ol className="mt-3 space-y-1.5 text-xs text-text-muted">
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className="flex gap-2">
              <span className="font-bold text-primary">{n}.</span>
              {t(`slack.tutorialStep${n}`)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

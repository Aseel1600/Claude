"use client";

import { useEffect, useState } from "react";
import { AppleField, AppleInput } from "@/shared/components";
import { HmacRecipeBlock } from "../../shared/HmacRecipeBlock";

export interface CustomConfig {
  endpointUrl: string;
  secretKey: string;
}

interface CustomConfigFormProps {
  value: CustomConfig;
  onChange: (v: CustomConfig) => void;
  t: (key: string) => string;
  isEditing?: boolean;
}

type UrlState = "idle" | "checking" | "ok" | "blocked" | "invalid";

export function CustomConfigForm({ value, onChange, t, isEditing }: CustomConfigFormProps) {
  const [urlState, setUrlState] = useState<UrlState>("idle");

  useEffect(() => {
    const url = value.endpointUrl.trim();
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
  }, [value.endpointUrl]);

  const urlHint =
    urlState === "checking"
      ? t("validateUrl.checking")
      : urlState === "ok"
        ? t("validateUrl.ok")
        : urlState === "blocked"
          ? t("validateUrl.blockedPrivate")
          : urlState === "invalid" && value.endpointUrl.trim()
            ? t("validateUrl.invalidUrl")
            : "";

  return (
    <div className="space-y-4">
      <AppleField
        id="custom-endpoint-url"
        label={t("custom.endpointUrl")}
        error={urlState === "blocked" || urlState === "invalid" ? urlHint : undefined}
        hint={urlState === "ok" || urlState === "checking" ? urlHint : undefined}
      >
        <AppleInput
          id="custom-endpoint-url"
          value={value.endpointUrl}
          onChange={(e) => onChange({ ...value, endpointUrl: e.target.value })}
          placeholder={t("custom.endpointUrlPlaceholder")}
        />
      </AppleField>
      <AppleField
        id="custom-secret-key"
        label={t("custom.secretKey")}
        hint={t("custom.secretKeyHint")}
      >
        <AppleInput
          id="custom-secret-key"
          type="password"
          value={value.secretKey}
          onChange={(e) => onChange({ ...value, secretKey: e.target.value })}
          placeholder={isEditing ? t("secretEditPlaceholder") : t("custom.secretKeyPlaceholder")}
          autoComplete="new-password"
        />
      </AppleField>
      <HmacRecipeBlock
        title={t("howItWorks.hmacRecipeTitle")}
        snippets={[
          { label: "Node.js", code: t("howItWorks.hmacRecipe") },
          { label: "Python", code: t("howItWorks.hmacRecipePython") },
          { label: "Bash", code: t("howItWorks.hmacRecipeBash") },
        ]}
      />
    </div>
  );
}

"use client";

import { AppleField, AppleInput } from "@/shared/components";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface TelegramConfigFormProps {
  value: TelegramConfig;
  onChange: (v: TelegramConfig) => void;
  t: (key: string) => string;
}

export function TelegramConfigForm({ value, onChange, t }: TelegramConfigFormProps) {
  return (
    <div className="space-y-4">
      <AppleField
        id="telegram-bot-token"
        label={t("telegram.botToken")}
        hint={t("telegram.botTokenHint")}
      >
        <AppleInput
          id="telegram-bot-token"
          type="password"
          value={value.botToken}
          onChange={(e) => onChange({ ...value, botToken: e.target.value })}
          placeholder={t("telegram.botTokenPlaceholder")}
          autoComplete="new-password"
        />
      </AppleField>
      <AppleField
        id="telegram-chat-id"
        label={t("telegram.chatId")}
        hint={t("telegram.chatIdHint")}
      >
        <AppleInput
          id="telegram-chat-id"
          value={value.chatId}
          onChange={(e) => onChange({ ...value, chatId: e.target.value })}
          placeholder={t("telegram.chatIdPlaceholder")}
        />
      </AppleField>
      <details className="rounded-lg border border-border bg-sidebar p-3">
        <summary className="cursor-pointer text-xs font-medium text-text-muted hover:text-text-main">
          {t("telegram.tutorial")}
        </summary>
        <ol className="mt-3 space-y-1.5 text-xs text-text-muted">
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className="flex gap-2">
              <span className="font-bold text-primary">{n}.</span>
              {t(`telegram.tutorialStep${n}`)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

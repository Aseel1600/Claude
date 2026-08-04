"use client";

/**
 * Server Error Page — P-1
 *
 * Per-page error boundary for unrecoverable errors within the
 * dashboard layout. Falls back to global-error.tsx if this fails.
 */

import { useTranslations } from "next-intl";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  const t = useTranslations("error");
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="text-[64px] mb-4" aria-hidden="true">
        🔧
      </div>
      <h1 className="text-[28px] font-bold mb-2 text-[var(--color-text-main)]">
        {t("internalServerError")}
      </h1>
      <p className="text-[15px] text-[var(--color-text-muted)] max-w-[400px] leading-relaxed mb-2">
        {t("internalServerErrorDesc")}
      </p>
      {error?.digest && (
        <p className="text-xs text-[var(--color-text-muted)] mb-6 font-mono">
          {t("errorId", { digest: error.digest })}
        </p>
      )}
      {process.env.NODE_ENV === "development" && error?.message && (
        <pre
          className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs max-w-[600px] overflow-auto text-left mb-6"
          aria-label={t("errorDetailsAria")}
        >
          {error.message}
        </pre>
      )}
      <div className="flex gap-3">
        <button
          onClick={reset}
          aria-label={t("retryLoadingAria")}
          className="px-6 py-2.5 rounded-lg text-white text-sm font-semibold cursor-pointer transition-all duration-200 motion-reduce:transition-none bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-accent)]"
        >
          {t("tryAgain")}
        </button>
        <a
          href="/dashboard"
          className="px-6 py-2.5 rounded-lg text-[var(--color-text-main)] text-sm font-semibold cursor-pointer transition-all duration-200 motion-reduce:transition-none border border-[var(--color-border)] hover:bg-[var(--color-bg-alt)] no-underline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-accent)]"
          aria-label={t("returnToDashboardAria")}
        >
          {t("goToDashboard")}
        </a>
        <a
          href="/status"
          className="px-6 py-2.5 rounded-lg text-[var(--color-text-main)] text-sm font-semibold cursor-pointer transition-all duration-200 motion-reduce:transition-none border border-[var(--color-border)] hover:bg-[var(--color-bg-alt)] no-underline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-accent)]"
          aria-label={t("openSystemStatusAria")}
        >
          {t("systemStatus")}
        </a>
      </div>
    </div>
  );
}

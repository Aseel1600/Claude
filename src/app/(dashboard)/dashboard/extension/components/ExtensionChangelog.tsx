"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";

/** Raw CHANGELOG.md of the extension repository. */
const EXTENSION_CHANGELOG_URL =
  "https://raw.githubusercontent.com/dealenx/oai-compatible-copilot-mod/main/CHANGELOG.md";

/** Trim the changelog to the latest N versions. */
function getLatestChangelogMarkdown(markdown: string, limit = 10): string {
  const parts = markdown.split(/^##\s+\[/gm);
  if (parts.length <= 1) {
    const truncated = markdown.slice(0, 5000).trimEnd();
    return markdown.length > 5000 ? `${truncated}\n\n...` : truncated;
  }
  const header = parts[0].trimEnd();
  const versions = parts
    .slice(1, limit + 1)
    .map((part) => `## [${part.trimEnd()}`)
    .join("\n\n");
  return [header, versions].filter(Boolean).join("\n\n");
}

const markdownComponents: Components = {
  h1({ children }) {
    return <h1 className="mb-6 text-2xl font-bold text-text-main">{children}</h1>;
  },
  h2({ children }) {
    return (
      <h2 className="mt-8 mb-4 flex items-center gap-2 text-lg font-bold text-text-main first:mt-0">
        <span className="material-symbols-outlined text-[20px] text-primary">sell</span>
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mt-5 mb-2 text-sm font-semibold uppercase text-text-main/80">{children}</h3>
    );
  },
  p({ children }) {
    return <p className="mb-2 text-sm leading-relaxed text-text-muted">{children}</p>;
  },
  ul({ children }) {
    return <ul className="my-3 flex flex-col gap-2">{children}</ul>;
  },
  li({ children }) {
    return (
      <li className="ml-2 flex items-start text-sm leading-relaxed text-text-muted">
        <span className="mr-3 mt-2 size-1.5 shrink-0 rounded-full bg-text-muted/30" />
        <span>{children}</span>
      </li>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold text-text-main">{children}</strong>;
  },
  code({ children }) {
    return (
      <code className="rounded border border-black/5 bg-bg-subtle px-1.5 py-0.5 font-mono text-[13px] text-text-main dark:border-white/5">
        {children}
      </code>
    );
  },
};

export default function ExtensionChangelog() {
  const t = useTranslations("extensionPage");
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchChangelog() {
      try {
        const res = await fetch(EXTENSION_CHANGELOG_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`Changelog fetch failed with ${res.status}`);
        const text = await res.text();
        setMarkdown(getLatestChangelogMarkdown(text, 10));
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchChangelog();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-32">
        <span className="material-symbols-outlined animate-spin text-[32px] text-text-muted/50">
          sync
        </span>
        <p className="text-sm text-text-muted">{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-muted">
        <span className="material-symbols-outlined mb-4 text-[48px] text-red-500/50">
          error_outline
        </span>
        <p>{t("changelogLoadFailed")}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/shared/components";

/** URL to download the extension VSIX via the local endpoint. */
const DOWNLOAD_URL = "/api/extension/download";

/** URL of the extension repository. */
const REPO_URL = "https://github.com/dealenx/oai-compatible-copilot-mod";

export default function ExtensionDownload() {
  const t = useTranslations("extensionPage");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-text-main">{t("downloadTitle")}</h2>
        <p className="text-sm leading-relaxed text-text-muted">{t("downloadDescription")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={DOWNLOAD_URL} download>
          <Button>{t("downloadButton")}</Button>
        </a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary">{t("viewRepoButton")}</Button>
        </a>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold uppercase text-text-main/80">{t("installTitle")}</h3>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-text-muted">
          <li>{t("installStep1")}</li>
          <li>{t("installStep2")}</li>
          <li>{t("installStep3")}</li>
        </ol>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold uppercase text-text-main/80">{t("configTitle")}</h3>
        <p className="text-sm leading-relaxed text-text-muted">{t("configDescription")}</p>
        <code className="rounded border border-border bg-bg-subtle px-3 py-2 font-mono text-[13px] text-text-main">
          {"oaicopilot.baseUrl = http://localhost:20128/v1"}
        </code>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold uppercase text-text-main/80">
          {t("requirementsTitle")}
        </h3>
        <p className="text-sm leading-relaxed text-text-muted">{t("requirementsDescription")}</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-text-muted">
          <li>{t("requirementVscode")}</li>
          <li>{t("requirementCopilotChat")}</li>
          <li>{t("requirementOmniroute")}</li>
        </ul>
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-bg-subtle p-3">
          <p className="text-xs font-semibold uppercase text-text-main/70">
            {t("compatibleIdeTitle")}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-text-muted">
            <li>{t("ideVscode")}</li>
            <li>{t("ideInsiders")}</li>
            <li>{t("ideCursor")}</li>
            <li>{t("ideWindsurf")}</li>
          </ul>
          <p className="mt-1 text-xs leading-relaxed text-text-muted/70">{t("ideNote")}</p>
        </div>
      </div>
    </div>
  );
}

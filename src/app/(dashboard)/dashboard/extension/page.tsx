"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, SegmentedControl } from "@/shared/components";
import ExtensionDownload from "./components/ExtensionDownload";
import ExtensionChangelog from "./components/ExtensionChangelog";

export default function ExtensionPage() {
  const t = useTranslations("extensionPage");
  const [activeTab, setActiveTab] = useState<"download" | "changelog">("download");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <div className="w-full sm:w-[240px]">
          <SegmentedControl
            options={[
              { label: t("downloadTab"), value: "download" },
              { label: t("changelogTab"), value: "changelog" },
            ]}
            value={activeTab}
            onChange={(val) => setActiveTab(val as "download" | "changelog")}
          />
        </div>
      </div>

      <Card className="min-h-[500px] overflow-hidden" padding="none">
        {activeTab === "download" ? <ExtensionDownload /> : <ExtensionChangelog />}
      </Card>
    </div>
  );
}

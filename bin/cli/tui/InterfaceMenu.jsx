import React, { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import { MenuSelect } from "../tui-components/MenuSelect.jsx";
import { t } from "../i18n.mjs";

function InterfaceMenuApp({ version, baseUrl, hasUpdate, latestVersion, onChoice }) {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column">
        <Text bold color="cyan">
          ⚡ OmniRoute {version ? `v${version}` : ""}
        </Text>
        <Text dimColor>{baseUrl}</Text>
      </Box>
      {hasUpdate && (
        <Box marginTop={1}>
          <Text color="yellow">
            {t("common.cli.tui.updateAvailable", { version: latestVersion })}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <MenuSelect
          items={[
            {
              value: "web",
              label: t("common.cli.tui.openWebUi"),
              hint: t("common.cli.tui.default"),
            },
            { value: "tui", label: t("common.cli.tui.interactiveDashboard") },
            { value: "daemon", label: t("common.cli.tui.background") },
            { value: "logs", label: t("common.cli.tui.liveLogs") },
            { value: "exit", label: t("common.cli.tui.exit") },
          ]}
          onSelect={(item) => onChoice(item.value)}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("common.cli.tui.menuFooter")}</Text>
      </Box>
    </Box>
  );
}

export async function showInterfaceMenu({ version, baseUrl, hasUpdate, latestVersion } = {}) {
  return new Promise((resolve) => {
    const { unmount } = render(
      <InterfaceMenuApp
        version={version}
        baseUrl={baseUrl}
        hasUpdate={hasUpdate}
        latestVersion={latestVersion}
        onChoice={(choice) => {
          unmount();
          resolve(choice);
        }}
      />
    );
  });
}

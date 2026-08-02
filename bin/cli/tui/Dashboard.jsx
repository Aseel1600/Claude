import React, { useState } from "react";
import { render, Box, Text, useInput } from "ink";
import Overview from "./tabs/Overview.jsx";
import Combos from "./tabs/Combos.jsx";
import Providers from "./tabs/Providers.jsx";
import Keys from "./tabs/Keys.jsx";
import Logs from "./tabs/Logs.jsx";
import Health from "./tabs/Health.jsx";
import Cost from "./tabs/Cost.jsx";
import { t } from "../i18n.mjs";

const TABS = [
  { id: "overview", label: t("common.cli.tui.overview"), Component: Overview },
  { id: "combos", label: t("common.cli.tui.combos"), Component: Combos },
  { id: "providers", label: t("common.cli.tui.providers"), Component: Providers },
  { id: "keys", label: t("common.cli.tui.keys"), Component: Keys },
  { id: "logs", label: t("common.cli.tui.logs"), Component: Logs },
  { id: "health", label: t("common.cli.tui.health"), Component: Health },
  { id: "cost", label: t("common.cli.tui.cost"), Component: Cost },
];

function DashboardApp({ port, baseUrl, apiKey, onExit }) {
  const [active, setActive] = useState(0);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) onExit();
    const n = parseInt(input, 10);
    if (n >= 1 && n <= TABS.length) setActive(n - 1);
    if (key.tab && !key.shift) setActive((a) => (a + 1) % TABS.length);
    if (key.tab && key.shift) setActive((a) => (a - 1 + TABS.length) % TABS.length);
  });

  const ActiveComponent = TABS[active]?.Component;

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} gap={1}>
        <Text bold color="cyan">
          OmniRoute
        </Text>
        <Text dimColor>|</Text>
        {TABS.map((tab, i) => (
          <Text
            key={tab.id}
            bold={i === active}
            underline={i === active}
            color={i === active ? "yellow" : undefined}
          >
            [{i + 1}]{tab.label}
          </Text>
        ))}
      </Box>
      <Box flexGrow={1} paddingX={1} paddingY={1}>
        {ActiveComponent && <ActiveComponent port={port} baseUrl={baseUrl} apiKey={apiKey} />}
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>{t("common.cli.tui.dashboardFooter")}</Text>
      </Box>
    </Box>
  );
}

export async function startInteractiveTui({ port = 20128, baseUrl, apiKey } = {}) {
  const resolvedUrl = baseUrl ?? `http://localhost:${port}`;
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <DashboardApp port={port} baseUrl={resolvedUrl} apiKey={apiKey} onExit={() => unmount()} />
    );
    waitUntilExit().then(resolve).catch(resolve);
  });
}

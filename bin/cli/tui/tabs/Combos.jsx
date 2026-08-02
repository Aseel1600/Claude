import React from "react";
import { Box, Text } from "ink";
import { HeaderSwr } from "../../tui-components/HeaderSwr.jsx";
import { DataTable } from "../../tui-components/DataTable.jsx";
import { t } from "../../i18n.mjs";

const SCHEMA = [
  { key: "name", header: t("common.cli.tui.name"), width: 20 },
  { key: "strategy", header: t("common.cli.tui.strategy"), width: 14 },
  { key: "targets", header: t("common.cli.tui.targets"), width: 8 },
  {
    key: "enabled",
    header: t("common.cli.tui.enabled"),
    width: 8,
    formatter: (v) => (v ? "✓" : "✗"),
  },
];

export default function Combos({ baseUrl, apiKey }) {
  const fetcher = React.useCallback(async () => {
    const res = await fetch(`${baseUrl}/api/combos`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    return res.ok ? res.json() : [];
  }, [baseUrl, apiKey]);

  return (
    <Box flexDirection="column">
      <HeaderSwr
        fetcher={fetcher}
        interval={10000}
        render={(data) => {
          const rows = Array.isArray(data) ? data : (data?.combos ?? []);
          return (
            <DataTable
              rows={rows.map((c) => ({
                name: c.name,
                strategy: c.strategy,
                targets: c.targets?.length ?? 0,
                enabled: c.enabled !== false,
              }))}
              schema={SCHEMA}
              selectable
            />
          );
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>{t("common.cli.tui.tabFooter")}</Text>
      </Box>
    </Box>
  );
}

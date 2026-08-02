import React from "react";
import { Box, Text } from "ink";
import { t } from "../i18n.mjs";

export function TokenCounter({ tokensIn = 0, tokensOut = 0, costUsd = 0, model }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{t("common.cli.tui.inLabel")} </Text>
        <Text>{tokensIn.toLocaleString()}</Text>
        <Text bold> {t("common.cli.tui.outLabel")} </Text>
        <Text>{tokensOut.toLocaleString()}</Text>
        <Text bold> {t("common.cli.tui.costLabel")} </Text>
        <Text color="yellow">${costUsd.toFixed(4)}</Text>
      </Box>
      {model && (
        <Text dimColor>
          {t("common.cli.tui.modelLabel")} {model}
        </Text>
      )}
    </Box>
  );
}

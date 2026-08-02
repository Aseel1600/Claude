import React from "react";
import { Text } from "ink";
import { t } from "../i18n.mjs";

const STATUS_MAP = {
  running: { label: t("common.cli.tui.running"), color: "green" },
  stopped: { label: t("common.cli.tui.stopped"), color: "red" },
  starting: { label: t("common.cli.tui.starting"), color: "yellow" },
  error: { label: t("common.cli.tui.error"), color: "red" },
  unknown: { label: t("common.cli.tui.unknown"), color: "gray" },
  ok: { label: t("common.cli.tui.ok"), color: "green" },
  warn: { label: t("common.cli.tui.warn"), color: "yellow" },
};

export function StatusBadge({ status = "unknown" }) {
  const s = STATUS_MAP[status] ?? { label: status, color: "gray" };
  return <Text color={s.color}>{s.label}</Text>;
}

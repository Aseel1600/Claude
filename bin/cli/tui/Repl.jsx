import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { apiFetch } from "../api.mjs";
import { TokenCounter } from "../tui-components/TokenCounter.jsx";
import { MarkdownView } from "../tui-components/MarkdownView.jsx";
import { saveSession, loadSession, listSessions, autosave, deleteSession } from "./session.mjs";
import { writeFileSync } from "node:fs";
import { t } from "../i18n.mjs";

marked.use(markedTerminal({ width: 80 }));

const SLASH_COMMANDS = [
  "model",
  "combo",
  "system",
  "clear",
  "save",
  "load",
  "list",
  "history",
  "export",
  "tokens",
  "file",
  "temperature",
  "max-tokens",
  "reasoning",
  "skill",
  "memory",
  "help",
  "exit",
  "quit",
];

function Message({ message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <Box flexDirection="column" marginBottom={1}>
      {isUser && (
        <Text color="green" bold>
          {">"}{" "}
        </Text>
      )}
      {isSystem && <Text color="yellow">[{t("common.cli.tui.systemLabel")}] </Text>}
      <MarkdownView content={message.content} />
      {message.latencyMs != null && (
        <Text dimColor>
          {t("common.cli.tui.messageMeta", {
            model: message.model,
            latency: message.latencyMs,
            tokens: message.usage?.total_tokens ?? "?",
          })}
        </Text>
      )}
    </Box>
  );
}

function SidePanel({ session }) {
  return (
    <Box flexDirection="column" width={20} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold underline>
        {t("common.cli.tui.session")}
      </Text>
      <Text>
        {t("common.cli.tui.model")}: <Text color="yellow">{session.model}</Text>
      </Text>
      {session.combo && (
        <Text>
          {t("common.cli.tui.combo")}: {session.combo}
        </Text>
      )}
      <Text>
        {t("common.cli.tui.messages")}: {session.messages.length}
      </Text>
      <Box marginTop={1}>
        <TokenCounter
          tokensIn={session.totalUsage.in}
          tokensOut={session.totalUsage.out}
          costUsd={session.totalCost}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor bold>
          {t("common.cli.tui.commands")}
        </Text>
        {["/model", "/combo", "/system", "/clear", "/save", "/load", "/tokens", "/exit"].map(
          (c) => (
            <Text key={c} dimColor>
              {c}
            </Text>
          )
        )}
      </Box>
    </Box>
  );
}

function ReplApp({ initialOptions, onExit }) {
  const [session, setSession] = useState(() => {
    if (initialOptions.resume) {
      try {
        return loadSession(initialOptions.resume);
      } catch {}
    }
    return {
      model: initialOptions.model || "auto",
      combo: initialOptions.combo || null,
      system: initialOptions.system || null,
      messages: [],
      totalUsage: { in: 0, out: 0 },
      totalCost: 0,
      createdAt: new Date().toISOString(),
    };
  });
  const [input, setInput] = useState("");
  const [historyBuf, setHistoryBuf] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [pending, setPending] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (statusMsg) {
      const t = setTimeout(() => setStatusMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [statusMsg]);

  useInput((char, key) => {
    if (pending) return;
    if (key.upArrow && !input) {
      const next = Math.min(historyIdx + 1, historyBuf.length - 1);
      if (next >= 0) {
        setHistoryIdx(next);
        setInput(historyBuf[historyBuf.length - 1 - next] || "");
      }
      return;
    }
    if (key.downArrow && historyIdx >= 0) {
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setInput(next < 0 ? "" : historyBuf[historyBuf.length - 1 - next] || "");
      return;
    }
    if (key.tab && input.startsWith("/")) {
      const partial = input.slice(1).split(" ")[0];
      const match = SLASH_COMMANDS.find((c) => c.startsWith(partial) && c !== partial);
      if (match) setInput("/" + match + " ");
    }
  });

  async function submit(value) {
    const text = (value ?? input).trim();
    if (!text) return;
    setInput("");
    setHistoryBuf((h) => [...h, text]);
    setHistoryIdx(-1);

    if (text.startsWith("/")) {
      await handleSlash(text);
    } else {
      await sendMessage(text);
    }
  }

  async function sendMessage(content) {
    setPending(true);
    const t0 = Date.now();
    const nextMsgs = [...session.messages, { role: "user", content }];
    setSession((s) => ({ ...s, messages: nextMsgs }));
    try {
      const payload = {
        model: session.model,
        messages: [
          ...(session.system ? [{ role: "system", content: session.system }] : []),
          ...nextMsgs,
        ],
      };
      if (session.combo) payload.combo = session.combo;
      const res = await apiFetch("/v1/chat/completions", {
        method: "POST",
        body: payload,
        baseUrl: initialOptions.baseUrl,
        apiKey: initialOptions.apiKey,
      });
      const data = await res.json();
      const latencyMs = Date.now() - t0;
      const replyContent = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage || {};
      const costUsd = data.cost_usd || 0;
      setSession((s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            role: "assistant",
            content: replyContent,
            model: data.model || s.model,
            latencyMs,
            usage,
          },
        ],
        totalUsage: {
          in: s.totalUsage.in + (usage.prompt_tokens || 0),
          out: s.totalUsage.out + (usage.completion_tokens || 0),
        },
        totalCost: s.totalCost + costUsd,
      }));
    } catch (err) {
      setSession((s) => ({
        ...s,
        messages: [
          ...s.messages,
          { role: "system", content: t("common.cli.tui.errorMessage", { message: err.message }) },
        ],
      }));
    } finally {
      setPending(false);
    }
  }

  async function handleSlash(line) {
    const parts = line.slice(1).trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    switch (cmd) {
      case "exit":
      case "quit":
        autosave(session);
        onExit();
        return;
      case "model":
        if (args[0]) {
          setSession((s) => ({ ...s, model: args[0] }));
          setStatusMsg(t("common.cli.tui.modelChanged", { model: args[0] }));
        }
        break;
      case "combo":
        setSession((s) => ({ ...s, combo: args[0] || null }));
        setStatusMsg(
          t("common.cli.tui.comboChanged", { combo: args[0] || t("common.cli.tui.none") })
        );
        break;
      case "system":
        setSession((s) => ({ ...s, system: args.join(" ") || null }));
        setStatusMsg(t("common.cli.tui.systemPromptUpdated"));
        break;
      case "clear":
        setSession((s) => ({ ...s, messages: [] }));
        setStatusMsg(t("common.cli.tui.historyCleared"));
        break;
      case "tokens":
        setSession((s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              role: "system",
              content: t("common.cli.tui.tokenSummary", {
                in: s.totalUsage.in,
                out: s.totalUsage.out,
                cost: s.totalCost.toFixed(4),
              }),
            },
          ],
        }));
        break;
      case "save":
        if (args[0]) {
          saveSession(args[0], session);
          setStatusMsg(t("common.cli.tui.sessionSaved", { name: args[0] }));
        } else {
          setStatusMsg(t("common.cli.tui.saveUsage"));
        }
        break;
      case "load":
        if (args[0]) {
          try {
            const loaded = loadSession(args[0]);
            setSession(loaded);
            setStatusMsg(t("common.cli.tui.sessionLoaded", { name: args[0] }));
          } catch {
            setStatusMsg(t("common.cli.tui.sessionNotFound", { name: args[0] }));
          }
        }
        break;
      case "list": {
        const sessions = listSessions();
        const content =
          sessions.length > 0
            ? sessions
                .map(
                  (s) => `• ${s.name}  ${s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ""}`
                )
                .join("\n")
            : t("common.cli.tui.noSavedSessions");
        setSession((s) => ({
          ...s,
          messages: [...s.messages, { role: "system", content }],
        }));
        break;
      }
      case "history": {
        const n = parseInt(args[0] || "10", 10);
        const msgs = session.messages
          .slice(-n)
          .map((m) => `[${m.role}] ${String(m.content).substring(0, 120)}`)
          .join("\n");
        setSession((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { role: "system", content: msgs || t("common.cli.tui.noHistory") },
          ],
        }));
        break;
      }
      case "export": {
        const filename = args[0];
        if (!filename) {
          setStatusMsg(t("common.cli.tui.exportUsage"));
          break;
        }
        try {
          const ext = filename.split(".").pop();
          let content;
          if (ext === "json") {
            content = JSON.stringify(session, null, 2);
          } else if (ext === "md") {
            content = session.messages
              .map((m) => `**${m.role}**\n\n${m.content}`)
              .join("\n\n---\n\n");
          } else {
            content = session.messages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
          }
          writeFileSync(filename, content);
          setStatusMsg(t("common.cli.tui.exported", { path: filename }));
        } catch (err) {
          setStatusMsg(t("common.cli.tui.exportFailed", { error: err.message }));
        }
        break;
      }
      case "temperature":
      case "max-tokens":
      case "reasoning":
        setStatusMsg(t("common.cli.tui.settingChanged", { setting: cmd, value: args[0] }));
        break;
      case "skill":
      case "memory":
        await sendMessage(line);
        break;
      case "help":
        setSession((s) => ({
          ...s,
          messages: [...s.messages, { role: "system", content: t("common.cli.tui.helpText") }],
        }));
        break;
      default:
        setStatusMsg(t("common.cli.tui.unknownCommand", { command: cmd }));
    }
  }

  return (
    <Box flexDirection="row" height={process.stdout.rows}>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {session.messages.map((m, i) => (
            <Message key={i} message={m} />
          ))}
          {pending && <Text color="cyan">{t("common.cli.tui.generating")}</Text>}
          {statusMsg && <Text color="green">{statusMsg}</Text>}
        </Box>
        <Box borderStyle="round" borderColor={pending ? "gray" : "cyan"}>
          <Text color="green">{"> "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
        <Text dimColor>{t("common.cli.tui.replFooter")}</Text>
      </Box>
      <SidePanel session={session} />
    </Box>
  );
}

export async function runRepl(opts = {}) {
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <ReplApp initialOptions={opts} onExit={() => unmount()} />
    );
    waitUntilExit().then(resolve);
  });
}

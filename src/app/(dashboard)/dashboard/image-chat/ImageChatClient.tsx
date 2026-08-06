"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownMessage from "../playground/components/MarkdownMessage";
import {
  ANALYSIS_MAX_EDGE,
  IMAGE_MODEL,
  VERIFIED_VISION_ROUTES,
  buildMultimodalMessages,
  computeTargetDimensions,
  estimateVisionTokens,
  extractGeneratedImage,
  isSendKey,
  resolveImageEndpoint,
  routeLabel,
  seedPromptFromAnswer,
  type ChatMessage,
} from "./imageChatHelpers";

interface Attachment {
  /** Downscaled copy sent to the vision model. */
  analysisUrl: string;
  /** Untouched original, used as the base for edits. */
  originalUrl: string;
  name: string;
  width: number;
  height: number;
  resized: boolean;
  estimatedTokens: number;
  /** Already delivered in a previous turn — kept in the tray as an edit base. */
  sent?: boolean;
}

const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

/** Reads a File/Blob as a data: URL. */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

/** Downscales a data: URL through a canvas, preserving aspect ratio. */
async function buildAnalysisCopy(
  dataUrl: string
): Promise<{ url: string; width: number; height: number; resized: boolean }> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Imagem inválida."));
  });

  const target = computeTargetDimensions(img.width, img.height, ANALYSIS_MAX_EDGE);
  if (!target.resized) {
    return { url: dataUrl, width: img.width, height: img.height, resized: false };
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: dataUrl, width: img.width, height: img.height, resized: false };
  ctx.drawImage(img, 0, 0, target.width, target.height);
  return {
    url: canvas.toDataURL("image/png"),
    width: target.width,
    height: target.height,
    resized: true,
  };
}

export default function ImageChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(VERIFIED_VISION_ROUTES[0]);
  const [size, setSize] = useState<string>(IMAGE_SIZES[0]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  /** Review draft: the prompt seeded from an assistant answer, before generating. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Index of the attachment used as the edit base; null generates from scratch. */
  const [baseIdx, setBaseIdx] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addFiles = async (files: FileList | File[]) => {
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const originalUrl = await readAsDataUrl(file);
        const analysis = await buildAnalysisCopy(originalUrl);
        next.push({
          analysisUrl: analysis.url,
          originalUrl,
          name: file.name || "colado.png",
          width: analysis.width,
          height: analysis.height,
          resized: analysis.resized,
          estimatedTokens: estimateVisionTokens(analysis.width, analysis.height),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao anexar imagem.");
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
    setBaseIdx((prev) => {
      if (prev === null) return null;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };

  /**
   * Appends the user turn.
   *
   * Only attachments not yet sent ride along: the tray persists across turns so
   * a reference stays available as an edit base, but re-sending the same image
   * on every message would inflate the context for no gain.
   */
  const pushUserTurn = (): ChatMessage[] => {
    const fresh = attachments.filter((a) => !a.sent);
    const turn: ChatMessage = {
      role: "user",
      content: input,
      attachments: fresh.map((a) => a.analysisUrl),
    };
    const next = [...messages, turn];
    setMessages(next);
    setInput("");
    if (fresh.length) {
      setAttachments((prev) => prev.map((a) => ({ ...a, sent: true })));
    }
    return next;
  };

  /** Text turn — streams from the chat endpoint. */
  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    const history = pushUserTurn();
    setLoading(true);
    setBusyLabel("conversando");
    setError(null);
    const started = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: buildMultimodalMessages(history),
          stream: true,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
        setError(msg);
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            try {
              const parsed = JSON.parse(line.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (!delta) continue;
              answer += delta;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: answer };
                return next;
              });
            } catch {
              // partial chunk — keep reading
            }
          }
        }
      }

      // A 2xx that streamed nothing is an upstream failure, not an empty answer.
      if (!answer.trim()) {
        setError("O provider respondeu 2xx sem conteúdo utilizável.");
        setMessages((prev) => prev.slice(0, -1));
      }
      // Attachments intentionally survive the turn: the reference stays usable
      // as an edit base for as long as the conversation is about it.
    } catch (err) {
      const e = err as { name?: string; message?: string };
      setError(e.name === "AbortError" ? "Requisição cancelada." : (e.message ?? "Falha de rede."));
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLastDuration(Date.now() - started);
      setLoading(false);
      setBusyLabel("");
    }
  };

  /**
   * Image turn.
   *
   * The endpoint is derived from state, not from the operator: a selected base
   * attachment means "edit", its absence means "generate". Both read as "make
   * me an image" from the outside.
   */
  const handleImage = async (prompt: string) => {
    if (loading) return;
    if (!prompt.trim()) {
      setError("O prompt da imagem está vazio.");
      return;
    }

    const base = baseIdx !== null ? attachments[baseIdx] : undefined;
    setLoading(true);
    setBusyLabel(base ? "editando imagem" : "gerando imagem");
    setError(null);
    setDraft(null);
    const started = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const endpoint = resolveImageEndpoint(Boolean(base));
      const body: Record<string, unknown> = base
        ? { model: IMAGE_MODEL, prompt, image: base.originalUrl, n: 1 }
        : { model: IMAGE_MODEL, prompt, size, n: 1 };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          (payload as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
        setError(msg);
        return;
      }

      const image = extractGeneratedImage(payload);
      setMessages((prev) => [...prev, { role: "assistant", content: "", image }]);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      setError(e.name === "AbortError" ? "Requisição cancelada." : (e.message ?? "Falha de rede."));
    } finally {
      setLastDuration(Date.now() - started);
      setLoading(false);
      setBusyLabel("");
    }
  };

  const imageSrc = (image: string) =>
    image.startsWith("http") || image.startsWith("data:")
      ? image
      : `data:image/png;base64,${image}`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && loading) {
      abortRef.current?.abort();
      return;
    }
    // Enter sends the conversation turn only — never an image generation, which
    // costs ~20s and quota and must stay an explicit click.
    if (isSendKey({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      void handleSend();
    }
  };

  /** Opens the review panel seeded with an assistant answer. */
  const openDraftFrom = (answer: string) => {
    setDraft(seedPromptFromAnswer(answer));
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Image Chat</h1>
        <p className="text-sm text-text-muted">
          Converse com um modelo de visão verificada, anexe referências (botão ou Ctrl+V) e
          gere ou edite imagens com <code>{routeLabel(IMAGE_MODEL)}</code>.
        </p>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-bg-subtle p-4 flex flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-sm text-text-muted m-auto">
            Nenhuma mensagem ainda. Escreva um prompt e use{" "}
            <strong>Responder</strong> para conversar ou <strong>Gerar imagem</strong>.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 max-w-[85%] ${
              m.role === "user"
                ? "self-end bg-primary/10 border border-primary/30"
                : "self-start bg-bg-main border border-border"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
              {m.role === "user" ? "você" : routeLabel(model)}
            </div>

            {m.attachments && m.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {m.attachments.map((a, k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={k}
                    src={a}
                    alt="referência anexada"
                    className="h-20 w-20 object-cover rounded border border-border"
                  />
                ))}
              </div>
            )}

            {m.image ? (
              <div className="flex flex-col gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc(m.image)}
                  alt="imagem gerada"
                  className="max-w-full rounded-md border border-border"
                />
                <a
                  href={imageSrc(m.image)}
                  download={`omniroute-${i}.png`}
                  className="text-xs text-primary hover:underline w-fit"
                >
                  Baixar PNG
                </a>
              </div>
            ) : (
              <>
                <MarkdownMessage content={m.content} />
                {m.role === "assistant" && m.content.trim() && (
                  <button
                    type="button"
                    onClick={() => openDraftFrom(m.content)}
                    disabled={loading}
                    className="mt-2 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    Gerar imagem a partir desta resposta
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Revisão do prompt antes de gerar — o passo que protege quota */}
      {draft !== null && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Revisar prompt{" "}
              {baseIdx !== null && (
                <span className="text-xs text-text-muted">
                  · usando o anexo {baseIdx + 1} como base (edição)
                </span>
              )}
            </span>
            <span className="text-xs text-text-muted">{draft.length} caracteres</span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-bg-main px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleImage(draft)}
              disabled={loading || !draft.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Gerar com este prompt
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-main"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Anexos pendentes */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {attachments.map((a, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.analysisUrl}
                alt={a.name}
                onClick={() => setBaseIdx((prev) => (prev === i ? null : i))}
                className={`h-20 w-20 object-cover rounded border cursor-pointer ${
                  baseIdx === i ? "border-primary ring-2 ring-primary" : "border-border"
                }`}
              />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-danger text-white text-xs leading-none"
                aria-label="Remover anexo"
              >
                ×
              </button>
              <div className="text-[10px] text-text-muted mt-1 text-center">
                {a.width}×{a.height}
                {a.resized && " (reduzida)"}
                <br />~{a.estimatedTokens} tk
                {baseIdx === i && <><br /><span className="text-primary">base da edição</span></>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-subtle p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Enter envia · Shift+Enter quebra linha · Ctrl+V cola uma imagem de referência"
          className="w-full resize-y rounded-md border border-border bg-bg-main px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-border bg-bg-main text-sm px-2 py-1.5"
            aria-label="Modelo de raciocínio"
          >
            {VERIFIED_VISION_ROUTES.map((r) => (
              <option key={r} value={r}>
                {routeLabel(r)}
              </option>
            ))}
          </select>

          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="rounded-md border border-border bg-bg-main text-sm px-2 py-1.5"
            aria-label="Tamanho da imagem"
          >
            {IMAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => e.target.files && void addFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-main"
          >
            Anexar
          </button>

          <div className="flex-1" />

          {loading && (
            <span className="text-xs text-text-muted">{busyLabel}…</span>
          )}
          {!loading && lastDuration !== null && (
            <span className="text-xs text-text-muted">{(lastDuration / 1000).toFixed(1)}s</span>
          )}

          {loading && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-main"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={loading}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Responder
          </button>
          <button
            type="button"
            onClick={() => openDraftFrom(input)}
            disabled={loading || !input.trim()}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-main disabled:opacity-50"
            title="Usa o texto da caixa como prompt, sem consultar o modelo de raciocínio"
          >
            Gerar direto
          </button>
        </div>
      </div>
    </div>
  );
}

import { NextResponse } from "next/server";
import { headers } from "next/headers";

export async function POST(req: Request) {
  try {
    const data = await req.json();
    console.log("[Telegram Webhook] Received update:", JSON.stringify(data));

    const message = data.message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error("[Telegram Webhook] TELEGRAM_BOT_TOKEN not configured");
      return NextResponse.json({ ok: false, error: "Missing bot token" }, { status: 500 });
    }

    // Call OmniRoute's internal chat completions (since we are in the same Next.js app, we can fetch from localhost:3001)
    // First, let's just send a thinking message
    const sendThinking = fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "🧠 Thinking..." }),
    });

    // Then process the chat
    const processChat = async () => {
      try {
        const response = await fetch("http://localhost:3001/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "auto", // OmniRoute can route 'auto'
            messages: [{ role: "user", content: text }],
            max_tokens: 2048,
          }),
        });

        let replyText = "Error communicating with AI.";
        if (response.ok) {
          const resJson = await response.json();
          replyText = resJson.choices?.[0]?.message?.content || "No response generated.";
        } else {
          const errorJson = await response.json().catch(() => ({}));
          replyText = `API Error ${response.status}: ${JSON.stringify(errorJson)}`;
        }

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: "HTML" }),
        });
      } catch (err) {
        console.error("[Telegram Webhook] Error processing chat:", err);
      }
    };

    // Run process asynchronously without blocking the webhook response
    Promise.allSettled([sendThinking, processChat()]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Telegram Webhook] Error processing webhook:", error);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

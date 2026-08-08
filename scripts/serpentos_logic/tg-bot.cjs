const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

let TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Try fetching from doppler if missing
if (!TOKEN) {
    try {
        TOKEN = execSync("doppler secrets get TELEGRAM_BOT_TOKEN --project serpent --config prd --plain", { encoding: 'utf-8' }).trim();
    } catch (e) {
        console.error("Failed to get token from Doppler");
        process.exit(1);
    }
}

let offset = 0;

function httpRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: { ...headers },
      timeout: 30000,
    };

    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(data);
      if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
    }

    const req = mod.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function sendMessage(chatId, text) {
    try {
        await httpRequest(`https://api.telegram.org/bot${TOKEN}/sendMessage`, 'POST', {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error("Failed to send message:", e.message);
    }
}

async function processMessage(msg) {
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text;

    console.log(`[Message] ${chatId}: ${text}`);
    
    if (text === '/start' || text === '/help') {
        await sendMessage(chatId, "<b>OmniRoute Bot</b>\nSend me any prompt to process via OmniRoute models.");
        return;
    }

    await sendMessage(chatId, "🧠 Думаю...");
    
    try {
        const response = await httpRequest("http://localhost:3001/api/v1/chat/completions", "POST", {
            model: "auto",
            messages: [{ role: "user", content: text }],
            max_tokens: 2048
        });

        if (response.status === 200) {
            const data = JSON.parse(response.data);
            const reply = data.choices?.[0]?.message?.content || "Empty response from OmniRoute.";
            await sendMessage(chatId, reply);
        } else {
            const err = JSON.parse(response.data);
            await sendMessage(chatId, `❌ OmniRoute Error:\n<pre>${err.error?.message || response.data}</pre>`);
        }
    } catch (e) {
        await sendMessage(chatId, `❌ Connection error: ${e.message}`);
    }
}

async function poll() {
    try {
        const res = await httpRequest(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=30&offset=${offset}`);
        if (res.status === 200) {
            const data = JSON.parse(res.data);
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    offset = update.update_id + 1;
                    if (update.message) {
                        await processMessage(update.message);
                    }
                }
            }
        } else if (res.status === 409) {
            console.error("Conflict! Another bot is running or webhook is active.");
            // delete webhook just in case
            await httpRequest(`https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true`);
        }
    } catch (e) {
        console.error("Poll error:", e.message);
    }
    setTimeout(poll, 1000);
}

// Clear webhook before polling
httpRequest(`https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true`)
  .then(() => {
      console.log("OmniRoute Telegram Bot started.");
      poll();
  })
  .catch(console.error);

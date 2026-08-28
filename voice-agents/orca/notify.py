import os
from pathlib import Path

import httpx
from dotenv import dotenv_values

PROJECT_DIR = Path(__file__).resolve().parent.parent


class Notifier:
    def __init__(self) -> None:
        self.cfg = dotenv_values(PROJECT_DIR / ".env")
        self.ntfy_url = self.cfg.get("NTFY_URL", "").strip().rstrip("/")
        self.tg_token = self.cfg.get("TELEGRAM_BOT_TOKEN", "").strip()
        self.tg_chat = self.cfg.get("TELEGRAM_CHAT_ID", "").strip()

    def enabled(self) -> bool:
        return bool(self.ntfy_url or (self.tg_token and self.tg_chat))

    def send(self, title: str, message: str) -> bool:
        if not self.enabled():
            return False
        ok = False
        if self.ntfy_url:
            try:
                httpx.post(self.ntfy_url, content=message, headers={"Title": title}, timeout=15)
                ok = True
            except Exception:
                pass
        if self.tg_token and self.tg_chat:
            try:
                httpx.post(
                    f"https://api.telegram.org/bot{self.tg_token}/sendMessage",
                    json={"chat_id": self.tg_chat, "text": f"{title}\n{message}"},
                    timeout=15,
                )
                ok = True
            except Exception:
                pass
        return ok
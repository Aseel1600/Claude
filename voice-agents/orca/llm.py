"""Gemeinsamer OmniRoute-LM-Call.

Vereint die bisherigen /chat/completions-Aufrufe aus ui/main.py (ask_llm,
describe_image) und orca/skills.py (_llm_call) an einer Naht. Die Konsumenten
formen ihre message-Liste selbst (system/user, Context, multimodal) — dieser
Einstieg übernimmt den HTTP-Transport inkl. Bearer-Guard und Response-Parse.
"""

import httpx

DEFAULT_TIMEOUT = 120.0


async def chat(
    messages: list[dict],
    *,
    model: str,
    timeout: float = DEFAULT_TIMEOUT,
    base_url: str,
    api_key: str = "",
) -> str:
    """Rufe /chat/completions auf und liefere den Text der ersten Wahl zurück."""
    payload = {"model": model, "messages": messages, "stream": False}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{base_url}/chat/completions", json=payload, headers=headers, timeout=timeout
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
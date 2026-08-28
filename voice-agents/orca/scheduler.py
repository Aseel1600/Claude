import asyncio
from datetime import datetime, timezone

from orca import queue as q
from orca import skills as sk


async def run_scheduled_jobs(interval_seconds: int = 60) -> None:
    while True:
        try:
            tick()
        except Exception:
            pass
        await asyncio.sleep(interval_seconds)


def parse_interval(expr: str | None) -> int | None:
    if not expr:
        return None
    expr = expr.strip().lower()
    if expr.endswith("min"):
        return int(expr[:-3].strip()) * 60
    if expr.endswith("h"):
        return int(expr[:-1].strip()) * 3600
    if expr.endswith("s"):
        return int(expr[:-1].strip())
    try:
        return int(expr) * 60
    except ValueError:
        return None


def tick() -> None:
    now = datetime.now(timezone.utc)
    for name, skill in sk.list_skills().items():
        expr = skill.get("schedule")
        interval = parse_interval(expr)
        if interval is None:
            continue
        last = q.last_run(name)
        if last is None:
            q.set_last_run(name, now.isoformat())
            continue
        from datetime import datetime as dt

        try:
            last_dt = dt.fromisoformat(last)
        except Exception:
            q.set_last_run(name, now.isoformat())
            continue
        elapsed = (now - last_dt).total_seconds()
        if elapsed >= interval:
            q.create_job(name, {"text": skill.get("default_input", "")}, trigger="cron")
            q.set_last_run(name, now.isoformat())
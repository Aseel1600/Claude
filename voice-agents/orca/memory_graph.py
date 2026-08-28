"""Buildet den Memory-Wissensgraphen für /memory.

Pure Transformation: Kanban-Karten, Jobs, Skills, Artifacts und Agenten-Meta
werden zu Nodes/Links/Triples + Sessions + Chat komprimiert. Kein HTTP, keine
I/O — die Rohdaten kommen von außen, die Zeit wird übergeben (testbar).
"""

import json

PIPELINE_HANDOFFS = [
    ("research", "tiktok-concept", "research → concept"),
    ("tiktok-concept", "tiktok-video-producer", "concept → produzieren"),
    ("tiktok-video-producer", "youtube-upload", "produzieren → publizieren"),
]


def build_graph(
    *,
    cards: list[dict],
    job_list: list[dict],
    skill_defs: dict,
    artifacts: list[dict],
    agent_file: dict,
    now: str,
) -> dict:
    nodes: list[dict] = []
    links: list[dict] = []
    triples: list[dict] = []
    node_ids: set[str] = set()

    def add_node(nid: str, ntype: str, meta: dict | None = None) -> None:
        if nid in node_ids:
            return
        node_ids.add(nid)
        nodes.append({"id": nid, "type": ntype, **(meta or {})})

    def add_link(source: str, target: str, relation: str, timestamp: str = "") -> None:
        if source == target or source not in node_ids or target not in node_ids:
            return
        links.append({"source": source, "target": target, "relation": relation, "timestamp": timestamp})

    def add_triple(subject: str, subject_type: str, relation: str, obj: str, object_type: str, timestamp: str = "") -> None:
        triples.append({"subject": subject, "subjectType": subject_type, "relation": relation, "object": obj, "objectType": object_type, "timestamp": timestamp})

    add_node("Sebastian", "Person", {"firstSeen": now})
    add_node("Windows workstation", "Device", {"firstSeen": now})
    add_node("Android / redmi-note-14", "Device", {"firstSeen": now})
    add_link("Sebastian", "Windows workstation", "operates")
    add_link("Sebastian", "Android / redmi-note-14", "carries")

    for agent_name, info in agent_file.items():
        add_node(agent_name, "Agent", {
            "firstSeen": info.get("last_seen", ""),
            "status": "stale" if info.get("stale") else "ok",
            "last_seen": info.get("last_seen", ""),
            "detail": info.get("detail", ""),
        })
        add_link("Sebastian", agent_name, "delegates")
        add_triple(agent_name, "Agent", "status", "stale" if info.get("stale") else "ok", "Status", info.get("last_seen", ""))

    for skill_name, skill in skill_defs.items():
        add_node(skill_name, "Skill", {
            "firstSeen": now,
            "description": skill.get("description", ""),
            "model": skill.get("model", ""),
            "pipeline": len(skill.get("pipeline", []) or []),
        })
        add_link("Sebastian", skill_name, "uses")
        if skill.get("description"):
            add_triple(skill_name, "Skill", "beschreibt", skill["description"][:120], "Note", now)

    for src, tgt, _rel in PIPELINE_HANDOFFS:
        if src in node_ids and tgt in node_ids:
            add_link(src, tgt, "handoff")
            add_triple(src, "Skill", "handoff", tgt, "Skill", now)

    for job in job_list:
        jid = job.get("id", "")[:12]
        skill = job.get("skill", "")
        result_preview = ""
        if job.get("result"):
            try:
                parsed = json.loads(job["result"])
                result_preview = str(parsed.get("response", ""))[:200]
            except (json.JSONDecodeError, AttributeError):
                result_preview = str(job.get("result", ""))[:200]
        add_node(jid, "Job", {
            "firstSeen": job.get("created_at", ""),
            "full_id": job.get("id", ""),
            "skill": skill,
            "status": job.get("status", ""),
            "trigger": job.get("trigger", ""),
            "created_at": job.get("created_at", ""),
            "finished_at": job.get("finished_at", ""),
            "result": result_preview,
        })
        if skill:
            add_node(skill, "Skill")
            add_link(jid, skill, "ran")
        add_triple(jid, "Job", "skill", skill, "Skill", job.get("created_at", ""))
        add_triple(jid, "Job", "status", job.get("status", ""), "Status", job.get("finished_at", job.get("created_at", "")))
        if job.get("trigger") == "pwa":
            add_link("Sebastian", jid, "ordered")

    for artifact in artifacts:
        aid = artifact.get("artifactId", "")[:12]
        atype = artifact.get("type", "file")
        add_node(aid, "Artifact", {
            "firstSeen": artifact.get("createdAt", ""),
            "artifact_type": atype,
            "source": artifact.get("source", ""),
            "tags": artifact.get("tags", []),
            "createdAt": artifact.get("createdAt", ""),
        })
        add_triple(aid, "Artifact", "typ", atype, "Type", artifact.get("createdAt", ""))
        for tag in artifact.get("tags", [])[:3]:
            add_node(tag, "Tag", {"firstSeen": now})
            add_link(aid, tag, "tagged")

    for card in cards:
        cid = card.get("id", "")[:12]
        column = card.get("column", "todo")
        add_node(cid, "Task", {
            "firstSeen": card.get("created", ""),
            "full_id": card.get("id", ""),
            "title": card.get("title", ""),
            "column": column,
            "source": card.get("source", ""),
            "note": card.get("note", ""),
            "created": card.get("created", ""),
            "updated": card.get("updated", ""),
        })
        add_node(column, "Status", {"firstSeen": now})
        add_link(cid, column, "status")
        add_triple(card.get("title", cid)[:80], "Task", "status", column, "Status", card.get("updated", ""))
        source = card.get("source", "")
        if source:
            add_node(source, "Platform", {"firstSeen": now})
            add_link(cid, source, "source")

    sessions = [{"_id": "omniroute", "projectName": "OmniRoute Memory", "platform": "local", "tripleCount": len(triples), "updatedAt": now}]
    for card in cards:
        sessions.append({
            "_id": card.get("id", "")[:12],
            "projectName": card.get("title", "Karte")[:60],
            "platform": card.get("source", "kanban"),
            "tripleCount": 1,
            "updatedAt": card.get("updated", now),
        })

    chat_parts: list[str] = []
    for job in job_list[:30]:
        try:
            user_text = json.loads(job.get("input", "{}")).get("text", "").strip()
        except Exception:
            user_text = ""
        if user_text:
            chat_parts.append(f"[User]: {user_text}")
        try:
            resp_text = json.loads(job.get("result", "{}")).get("response", "").strip()
        except Exception:
            resp_text = ""
        if resp_text:
            chat_parts.append(f"[Assistant]: {resp_text}")

    return {
        "sessions": sessions,
        "nodes": nodes,
        "links": links,
        "triples": triples,
        "chat": {"rawText": "\n\n".join(chat_parts), "messageCount": len(chat_parts), "createdAt": now},
    }
"""Systematic Playwright test for the OmniRoute Control Room UI.

Usage:
    python ui/tests/control_room_test.py
    UI_BASE=http://127.0.0.1:20139 python ui/tests/control_room_test.py

Base URL defaults to http://127.0.0.1:20129/ and can be overridden via the
UI_BASE environment variable (used by with_server.py runs on other ports).
Exit code 0 = all checks passed, 1 = failures.
"""
import os
import re
import sys
import time
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("UI_BASE", "http://127.0.0.1:20129/")
if not BASE.endswith("/"):
    BASE += "/"
results = []
console_errors = []

ENV_PATH = Path(r"C:\OmniRoute\voice-agents\.env")
UI_TOKEN = ""
if ENV_PATH.exists():
    m = re.search(r"^UI_ACCESS_TOKEN=(.*)$", ENV_PATH.read_text(encoding="utf-8"), re.M)
    if m:
        UI_TOKEN = m.group(1).strip().strip('"').strip("'").rstrip("\r")


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + f" | {name}" + (f" | {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: console_errors.append("PAGEERROR: " + str(err)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")

    # --- 1. Initial load / orchestra dashboard ---
    check("seite lädt", "Orchestra Control Room" in page.title())
    check("h1 sichtbar", page.get_by_role("heading", name="The orchestra is in position.").is_visible())
    check("canvas panel da", page.get_by_role("heading", name="Orchestration canvas").is_visible())
    check("canvas nodes gerendert", page.locator(".canvas-agent").count() >= 3)
    check("live sync meta", "live sync" in page.locator("#sync-meta").inner_text())
    check("agent fleet", page.locator(".agent-row").count() >= 5)
    check("event feed", page.locator(".feed-row").count() >= 3)

    # --- 2. Canvas interactions ---
    agents = page.locator(".canvas-agent")
    agents.first.click()
    page.wait_for_timeout(400)
    check("agent-drawer öffnet", page.locator("#drawer-backdrop:not([hidden])").count() == 1 and page.locator("#drawer-title").inner_text() != "Details")
    page.locator("#drawer-close").click()
    page.wait_for_timeout(200)
    bus_jobs = page.locator(".bus-job")
    if bus_jobs.count():
        bus_jobs.first.click()
        page.wait_for_timeout(800)
        check("job-drawer öffnet", page.locator("#drawer-kicker").inner_text() == "JOB TRACE")
        page.locator("#drawer-close").click()
        page.wait_for_timeout(200)
    else:
        check("bus-jobs vorhanden", True, "kein Job-Punkt auf der Schiene (keine recent jobs im Moment)")

    # --- 3. All ten nav views render ---
    views = {
        "canvas": "Orchestration canvas", "devices": "Device plane", "jobs": "Job trace", "projects": "Projekt-Portfolio",
        "memory": "Kanban board", "artifacts": "Artifact registry", "ledger": "Ledger summary",
        "approvals": "Approval inbox", "settings": "Zugang & Datenschutz",
    }
    for view, panel_title in views.items():
        page.locator(f'.nav-item[data-view="{view}"]').click()
        page.wait_for_timeout(500)
        ok = page.locator(f"#{'view-' + view}").is_visible()
        heading_ok = page.get_by_role("heading", name=panel_title).is_visible() if page.get_by_role("heading", name=panel_title).count() else False
        check(f"view {view} sichtbar", ok and heading_ok)
    # canvas view: dashboard + dashboard-panel hidden, only the big canvas visible
    page.locator('.nav-item[data-view="canvas"]').click()
    page.wait_for_timeout(600)
    check("canvas: dashboard versteckt", page.locator("#dashboard-view").is_hidden())
    check("canvas: dashboard-panel versteckt", page.locator("#dashboard-canvas-panel").is_hidden())
    check("canvas: grosse view sichtbar", page.locator("#canvas-view-root").is_visible())
    check("canvas: bus-jobs in grosser view", page.locator("#canvas-view-root .bus-job").count() >= 3)
    check("canvas: legende sichtbar", page.locator(".canvas-legend").is_visible())
    # back to orchestra
    page.locator('.nav-item[data-view="orchestra"]').click()
    page.wait_for_timeout(400)
    check("zurück zu orchestra", page.locator("#dashboard-view").is_visible() and not page.locator("#dashboard-view").is_hidden())

    # --- 4. Job filter chips ---
    page.locator('.nav-item[data-view="jobs"]').click()
    page.wait_for_timeout(600)
    for chip in ["running", "done", "failed", "all"]:
        page.locator(f'#job-filters .filter-chip[data-filter="{chip}"]').click()
        page.wait_for_timeout(300)
        active = page.locator(f'#job-filters .filter-chip[data-filter="{chip}"]').get_attribute("aria-pressed") or page.locator(f'#job-filters .filter-chip[data-filter="{chip}"]').evaluate("el => el.classList.contains('active')")
        check(f"job-filter {chip} aktiv", bool(active))

    # --- 5. Approval buttons ---
    page.locator('.nav-item[data-view="approvals"]').click()
    page.wait_for_timeout(400)
    approve_btn = page.locator("[data-approve]").first
    if approve_btn.count():
        approve_btn.click()
        page.wait_for_timeout(200)
        check("approval freigeben", "Freigegeben" in page.locator(".approval-row").first.inner_text())

    # --- 6. Settings: services list + privacy toggle ---
    page.locator('.nav-item[data-view="settings"]').click()
    page.wait_for_timeout(600)
    check("services liste", page.locator(".service-row").count() >= 5)
    page.locator("#settings-privacy").click()
    page.wait_for_timeout(200)
    check("privacy mute togglet", page.locator("#privacy-hint").inner_text() == "Alle Erfassung stummgeschaltet")
    page.locator("#settings-privacy").click()

    # --- 7. Command bar preview mode ---
    page.locator(".nav-item[data-view=orchestra]").click()
    page.wait_for_timeout(300)
    page.locator("#command-input").fill("Testauftrag an das Orchester")
    page.locator("#command-send").click()
    page.wait_for_timeout(400)
    drawer_visible = page.locator("#drawer-backdrop:not([hidden])").count() == 1
    check("command preview drawer", drawer_visible)
    page.locator("#drawer-close").click()
    page.wait_for_timeout(200)

    # --- 8. Console errors ---
    real_errors = [e for e in console_errors if "401" not in e and "Failed to load resource" not in e and "favicon" not in e.lower()]
    check("keine console/page errors", len(real_errors) == 0, "; ".join(real_errors[:5]))

    # --- 8b. PWA: manifest, icons, service worker, offline cache ---
    manifest_link = page.locator('link[rel="manifest"]').first.get_attribute("href") if page.locator('link[rel="manifest"]').count() else None
    check("pwa: manifest link da", bool(manifest_link))
    if manifest_link:
        with page.expect_response(lambda r: manifest_link in r.url) as resp_info:
            page.evaluate("(href) => fetch(href)", manifest_link)
        m = resp_info.value.json()
        check("pwa: manifest gültig", m.get("name") == "OmniRoute Control Room" and m.get("display") == "standalone" and len(m.get("icons", [])) >= 3)
    sw_ready = page.evaluate("""() => navigator.serviceWorker.getRegistrations().then(rs => rs.length > 0)""")
    check("pwa: service worker registriert", sw_ready)
    cached = page.evaluate("""() => caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().map(r => new URL(r.url).pathname))""")
    check("pwa: offline cache gefüllt", "/static/index.html" in cached and "/" in cached)
    icon_ok = page.evaluate("""(paths) => Promise.all(paths.map(p => fetch(p).then(r => r.ok)))""", ["/static/icon-192.png", "/static/icon-512.png"])
    check("pwa: icons erreichbar", all(icon_ok))

    # --- 9. Mobile viewport: no horizontal overflow ---
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check("mobile kein overflow", not overflow, f"scrollW={page.evaluate('document.documentElement.scrollWidth')}")
    page.locator('.nav-item[data-view="jobs"]').click()
    page.wait_for_timeout(500)
    check("mobile jobs table scrollbar", page.locator("#job-table").is_visible())

    # --- 10. Keyboard / a11y path ---
    # skip-link test im frischen Zustand (nach Reload ist body der natürliche Fokuspunkt)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    page.keyboard.press("Tab")
    check("skip-link als erstes fokussiert", page.evaluate("document.activeElement === document.querySelector('.skip-link')"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check("skip-link springt zum main", page.evaluate("document.activeElement === document.getElementById('main-content')"))
    # drawer fokuszyklus: agent-knoten öffnen, Escape schließt, fokus zurück
    page.locator(".canvas-agent").first.click()
    page.wait_for_timeout(300)
    check("drawer fokus liegt auf close", page.evaluate("document.activeElement === document.getElementById('drawer-close')"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("escape schließt drawer", page.locator("#drawer-backdrop").get_attribute("hidden") is not None)
    check("fokus zurück am auslöser", page.evaluate("document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('canvas-agent')"))
    # tab zyklus: fokus bleibt im drawer (öffnen erneut, da der canvas-agent durch syncDashboard neu gerendert sein kann)
    page.locator(".canvas-agent").first.click()
    page.wait_for_timeout(300)
    page.keyboard.press("Shift+Tab")
    page.wait_for_timeout(200)
    in_drawer = page.evaluate("document.querySelector('.drawer').contains(document.activeElement)")
    check("tab-falle hält fokus im drawer", in_drawer)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # --- 11. Token path: live data in protected views ---
    if UI_TOKEN:
        page.evaluate("(t) => localStorage.setItem('ui_token', t)", UI_TOKEN)
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(600)
        page.locator('.nav-item[data-view="projects"]').click()
        page.wait_for_timeout(700)
        check("token: projects lädt ohne preview-hinweis", "Kein Token" not in page.locator("#project-empty").inner_text())
        page.locator('.nav-item[data-view="ledger"]').click()
        page.wait_for_timeout(700)
        check("token: ledger summary lädt", "Ledger im Preview verborgen" not in page.locator("#ledger-empty").inner_text())
        page.locator('.nav-item[data-view="artifacts"]').click()
        page.wait_for_timeout(700)
        check("token: artifacts lädt", "Artifact-Registry im Preview verborgen" not in page.locator("#artifact-empty").inner_text())
        page.locator('.nav-item[data-view="memory"]').click()
        page.wait_for_timeout(700)
        check("token: kanban lädt", page.locator(".kanban-col").count() >= 3)

        # --- Approvals wiring: real kanban cards, approve moves card to done ---
        import json as _json
        from urllib import request as _req

        def _api(method, path, body=None):
            data = _json.dumps(body).encode() if body is not None else None
            req = _req.Request(BASE + path, data=data, headers={"X-Access-Token": UI_TOKEN, "Content-Type": "application/json"}, method=method)
            with _req.urlopen(req, timeout=15) as resp:
                return _json.loads(resp.read().decode())

        appr_card_id = None
        try:
            created = _api("POST", "kanban", {"title": "TEST-Approval Karte", "note": "Verdrahtungs-Test", "source": "e2e-test"})
            appr_card_id = created["card"]["id"]
            check("approvals: test-karte angelegt", bool(appr_card_id))
            page.locator('.nav-item[data-view="approvals"]').click()
            page.wait_for_timeout(800)
            appr_row = page.locator(f'[data-card="{appr_card_id}"]')
            check("approvals: test-karte in inbox sichtbar", appr_row.count() == 1)
            appr_row.locator("[data-approve]").click()
            page.wait_for_timeout(600)
            check("approvals: freigeben zeigt erfolg", "Freigegeben" in appr_row.inner_text())
            state = page.evaluate("(cid) => fetch('/kanban', { headers: { 'X-Access-Token': localStorage.getItem('ui_token') } }).then(r => r.json()).then(d => { const c = (d.cards || []).find(x => x.id === cid); return c ? c.column : null; })", appr_card_id)
            check("approvals: karte nach done verschoben", state == "done", f"| column={state}")
        except Exception as e:
            check("approvals: verdrahtung", False, str(e)[:120])
        finally:
            if appr_card_id:
                try:
                    _api("DELETE", "kanban/" + appr_card_id)
                    gone = _api("GET", "kanban")["cards"]
                    check("approvals: test-karte aufgeräumt", not any(c["id"] == appr_card_id for c in gone))
                except Exception as e:
                    check("approvals: test-karte aufgeräumt", False, str(e)[:120])
    else:
        check("token: UI_ACCESS_TOKEN in .env gefunden", False, "kein Token in .env gefunden")

    # --- 12. E2E job trigger: create a real job, verify it in canvas + trace ---
    if UI_TOKEN:
        import json as _json
        import urllib.parse
        from urllib import request as _req

        test_skill = "daily-brainstorm"
        test_text = "Playwright E2E Testauftrag " + uuid.uuid4().hex[:8]
        job_id = None
        try:
            data = urllib.parse.urlencode({"skill": test_skill, "text": test_text}).encode()
            req = _req.Request(BASE + "orca/jobs", data=data, headers={"X-Access-Token": UI_TOKEN, "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
            with _req.urlopen(req, timeout=15) as resp:
                job_id = _json.loads(resp.read().decode())["job"]["id"]
            check("e2e: job via /orca/jobs erstellt", bool(job_id), job_id or "")
        except Exception as e:
            check("e2e: job via /orca/jobs erstellt", False, str(e)[:120])
        if job_id:
            # wait for the job to be picked up / indexed, then reload UI and check canvas + trace
            time.sleep(3)
            page.locator('.nav-item[data-view="orchestra"]').click()
            page.wait_for_timeout(400)
            page.reload()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(800)
            page.locator('.nav-item[data-view="jobs"]').click()
            page.wait_for_timeout(800)
            # trace table (token path loads full list)
            table_text = page.locator("#job-table").inner_text()
            check("e2e: job im job-trace sichtbar", job_id in table_text)
            # canvas: reload orchestra and look for the skill on the bus rail
            page.locator('.nav-item[data-view="orchestra"]').click()
            page.wait_for_timeout(600)
            canvas_text = page.locator("#orchestra-canvas").inner_text()
            check("e2e: job erscheint im canvas (bus-rail)", "DAILY-BRAIN" in canvas_text.upper() or test_skill in canvas_text)
            # detail drawer from trace row
            page.locator('.nav-item[data-view="jobs"]').click()
            page.wait_for_timeout(600)
            row = page.locator(f'#job-tbody tr[data-job="{job_id}"]')
            if row.count():
                row.first.click()
                page.wait_for_timeout(800)
                check("e2e: job-detail-drawer zeigt test-job", page.locator("#drawer-kicker").inner_text() == "JOB TRACE" and test_skill in page.locator("#drawer-title").inner_text())
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
            else:
                check("e2e: job-detail-drawer zeigt test-job", False, "Zeile nicht in Tabelle gefunden")
    else:
        check("e2e: job-trigger übersprungen", True, "kein Token — E2E-Job-Test nur mit Token möglich")

    # Aufräumen: die vom E2E-Test erzeugten Test-Jobs wieder aus der lokalen DB entfernen,
    # damit sie den echten Job-Trace nicht verunreinigen.
    try:
        import sqlite3
        db_path = Path(r"C:\OmniRoute\voice-agents\data\jobs.db")
        if db_path.exists():
            db = sqlite3.connect(str(db_path))
            cleaned = db.execute("DELETE FROM jobs WHERE input LIKE '%Playwright E2E%' OR input LIKE '%DBG E2E%'").rowcount
            db.commit()
            db.close()
            check("e2e: test-jobs aufgeräumt", True, str(cleaned) + " gelöscht")
        else:
            check("e2e: test-jobs aufgeräumt", True, "keine lokale jobs.db")
    except Exception as e:
        check("e2e: test-jobs aufgeräumt", True, "cleanup übersprungen: " + str(e)[:80])

    page.screenshot(path="control_room_final.png", full_page=False)
    browser.close()

fails = [r for r in results if not r["ok"]]
print("\n=== SUMMARY ===")
print(f"{len(results) - len(fails)}/{len(results)} passed")
if fails:
    print("FAILED:")
    for f in fails:
        print(" -", f["name"], "|", f["detail"])
    sys.exit(1)
sys.exit(0)

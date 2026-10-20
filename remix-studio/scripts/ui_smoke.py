"""Browser smoke test of the whole UI against `python dev_server.py` (mobile 375px + desktop).

    python dev_server.py &
    python scripts/ui_smoke.py /tmp/ui-shots
"""
import sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
from playwright.sync_api import sync_playwright, expect
SP = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui-shots"
Path(SP).mkdir(parents=True, exist_ok=True)
from synth import song
from backend import audio_io
audio_io.encode(song(100, 25)[0] * 0.7, f"{SP}/שיר-בדיקה.mp3", "mp3")
BASE = "http://localhost:8000"
errors = []
def run(width, height, label, mobile):
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        ctx = b.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile,
                            permissions=["microphone"], locale="he-IL")
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append(f"[{label}] console {m.type}: {m.text}") if m.type in ("error",) else None)
        pg.on("pageerror", lambda e: errors.append(f"[{label}] pageerror: {e}"))
        pg.goto(BASE)
        pg.wait_for_selector("#screen-login:not([hidden])")
        pg.screenshot(path=f"{SP}/{label}-1-login.png", full_page=True)
        pg.fill("#password", "wrong")
        pg.click("#login-btn")
        expect(pg.locator("#login-error")).to_have_text("סיסמה שגויה.")
        pg.fill("#password", "dev")
        pg.click("#login-btn")
        pg.wait_for_selector("#screen-home:not([hidden])")
        pg.wait_for_selector("#presets .chip")
        assert pg.locator("#go-btn").is_disabled()
        pg.screenshot(path=f"{SP}/{label}-2-home.png", full_page=True)
        # horizontal scroll check
        sw = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
        assert sw <= cw, f"horizontal scroll {sw}>{cw}"
        # recording flow
        pg.click("#record-btn")
        pg.wait_for_selector("#recorder:not([hidden])")
        time.sleep(2.5)
        pg.click("#rec-stop")
        pg.wait_for_selector("#source-ready:not([hidden])")
        name = pg.inner_text("#file-name")
        assert name.startswith("הקלטה-"), name
        pg.screenshot(path=f"{SP}/{label}-3-recorded.png", full_page=True)
        pg.click("#file-clear")
        # upload file
        pg.set_input_files("#file-input", f"{SP}/שיר-בדיקה.mp3")
        pg.wait_for_selector("#source-ready:not([hidden])")
        expect(pg.locator("#file-info")).to_contain_text("00:25")
        pg.click('#presets .chip:has-text("מזרחית")')
        pg.fill("#instruction", "תעשה מזה מזרחית קצבית ותאיץ קצת")
        assert not pg.locator("#go-btn").is_disabled()
        pg.screenshot(path=f"{SP}/{label}-4-ready.png", full_page=True)
        pg.click("#go-btn")
        pg.wait_for_selector("#screen-job:not([hidden])")
        pg.wait_for_function("location.hash.startsWith('#/job/')", timeout=30000)
        time.sleep(1.5)
        pg.screenshot(path=f"{SP}/{label}-5-processing.png", full_page=True)
        jid = pg.evaluate("location.hash.split('/')[2]")
        # leave and come back
        pg.goto(BASE + "/#/history")
        pg.wait_for_selector("#history-list li a")
        pg.goto(BASE + "/")
        pg.wait_for_function(f"location.hash === '#/job/{jid}'", timeout=10000)
        pg.wait_for_selector("#job-result:not([hidden])", timeout=120000)
        pg.screenshot(path=f"{SP}/{label}-6-result.png", full_page=True)
        notes = pg.inner_text("#notes"); facts = pg.inner_text("#facts")
        files = pg.locator("#files li").count()
        # A/B toggle
        pg.click('#ab [data-src="original"]')
        time.sleep(0.5)
        src = pg.eval_on_selector("#result-audio", "a => a.src")
        assert "/input" in src, src
        pg.click('#ab [data-src="result"]')
        # download
        with pg.expect_download() as dl:
            pg.locator("#files li a").first.click()
        d = dl.value
        print(label, "download:", d.suggested_filename)
        # another version
        pg.click("#again-btn")
        pg.click('#again-presets .chip:has-text("האוס")')
        pg.fill("#again-instruction", "יותר מהיר עם דרופ")
        pg.click("#again-go")
        pg.wait_for_function(f"location.hash.startsWith('#/job/') && location.hash !== '#/job/{jid}'", timeout=20000)
        pg.wait_for_selector("#job-result:not([hidden])", timeout=120000)
        print(label, "again notes:", pg.inner_text("#notes"))
        # history + delete
        pg.goto(BASE + "/#/history")
        pg.wait_for_selector("#history-list li a")
        n0 = pg.locator("#history-list li").count()
        pg.screenshot(path=f"{SP}/{label}-7-history.png", full_page=True)
        pg.on("dialog", lambda dlg: dlg.accept())
        pg.locator("#history-list li .btn-danger").last.click()
        pg.wait_for_function(f"document.querySelectorAll('#history-list li').length === {n0-1}")
        sw = pg.evaluate("document.documentElement.scrollWidth"); cw = pg.evaluate("document.documentElement.clientWidth")
        assert sw <= cw, f"horizontal scroll {sw}>{cw}"
        # logout -> 401 -> login
        pg.click("#logout")
        pg.wait_for_selector("#screen-login:not([hidden])")
        print(label, "OK", "| notes:", notes, "| facts:", facts.replace("\n"," "), "| files:", files)
        b.close()
run(375, 812, "mobile", True)
run(1280, 900, "desktop", False)
print("\n".join(errors) or "no console errors")

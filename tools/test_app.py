"""End-to-end test. Usage: .venv/bin/python tools/test_app.py <url> [--shots]"""
import sys, json, re
from playwright.sync_api import sync_playwright
URL = sys.argv[1]; SHOTS = "--shots" in sys.argv
SHOTDIR = "preview/pages" if "github.io" in URL else "preview/live" if URL.startswith("https://") else "preview"
EXPECT_LS = "--expect-ls" in sys.argv
IPHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
fails = []
def wait(pg, expr, timeout=8000):
    import time; end = time.time() + timeout / 1000
    while time.time() < end:
        try:
            if pg.evaluate("() => !!(" + expr + ")"): return
        except Exception: pass
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)
def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond: fails.append(msg)
def shot(pg, name):
    if SHOTS: pg.screenshot(path=f"{SHOTDIR}/{name}.png")
def offset_script(days): return f"""(()=>{{const off={days}*86400000;const RD=Date;class D extends RD{{constructor(...a){{if(a.length===0)super(RD.now()+off);else super(...a)}}static now(){{return RD.now()+off}}}};window.Date=D;}})();"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(**IPHONE); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and "cloudflareinsights" not in m.text and errs.append(m.text))
    r = pg.goto(URL, wait_until="load"); wait(pg, "window.__ready")
    mode = pg.evaluate("store.mode"); print("storage mode:", mode)
    if EXPECT_LS: check(mode == "ls" and not pg.is_visible("#notice"), "localStorage works, no storage-blocked notice")
    NW = pg.evaluate("WORDS.length"); NA = pg.evaluate("Object.values(AUDIO).reduce((s,o)=>s+Object.keys(o).length,0)")
    check(NW >= 19 and NA == 2 * NW, f"{NW} words / {NA} embedded clips (2 per word)")
    clips = pg.evaluate("""()=>Promise.all(Object.values(AUDIO).flatMap(o=>[o.w,o.e]).map(s=>new Promise(r=>{const a=new Audio();a.oncanplaythrough=()=>r(a.duration);a.onerror=()=>r(-1);a.src=s;a.load();setTimeout(()=>r(-2),8000)})))""")
    check(len(clips) == NA and all(c > 0 for c in clips), f"all {len(clips)} embedded clips decode")
    check(pg.is_visible("#notice") == (mode == "hash"), "storage notice shown only when storage blocked")
    check(pg.inner_text("#dueCount") == "10", "home shows 10 new words due on day 1")
    covered = pg.evaluate("""() => [...document.querySelectorAll('#nav button')].filter(b => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return !b.contains(e); }).map(b => b.dataset.tab)""")
    check(not covered, f"bottom nav buttons not covered by overlays {covered or ''}")
    shot(pg, "home" if mode == "ls" else "home-storage-blocked")
    # --- daily review
    pg.tap("[data-act=start]"); pg.wait_for_timeout(300)
    check(pg.evaluate("player && !player.paused"), "word audio auto-plays on review card")
    pg.tap("[data-act=show]"); shot(pg, "daily-review")
    first = pg.evaluate("ses.q[0].id"); pg.tap("[data-grade='2']")
    second = pg.evaluate("ses.q[1].id"); pg.tap("[data-act=show]"); pg.tap("[data-grade='1']")
    third = pg.evaluate("ses.q[2].id"); pg.tap("[data-act=show]"); pg.tap("[data-grade='0']")
    p = pg.evaluate("S.p"); t = pg.evaluate("today()")
    check(p[first]["b"] == 2 and p[first]["d"] == t + 2, f"記得 → box 2, due in 2 days ({first})")
    check(p[second]["b"] == 1 and p[second]["d"] == t + 1, f"有啲唔確定 → box 1, due tomorrow ({second})")
    check(p[third]["b"] == 1 and p[third]["d"] == t + 1 and p[third]["l"] == 1, f"唔記得 → box 1, lapse counted ({third})")
    check(pg.evaluate("ses.q.length") == 11 and pg.evaluate("ses.q[10].id") == third, "唔記得 card re-queued at end of session")
    for _ in range(7):
        pg.tap("[data-act=show]"); pg.tap("[data-grade='2']")
    pg.tap("[data-act=show]"); pg.tap("[data-grade='2']")   # relearn card
    check("完成今日溫習" in pg.inner_text("#tab-home"), "session completes")
    pg.tap("[data-act=home]")
    check(pg.inner_text("#dueCount") == "0", "after session: 0 due today")
    check(pg.evaluate("streak()") == 1, "streak = 1")
    # --- quiz: spelling
    pg.tap("#nav [data-tab=quiz]"); pg.tap("[data-act=go]"); pg.wait_for_timeout(200)
    wid = pg.evaluate("qz.items[0]"); word = pg.evaluate(f"byId('{wid}').word")
    pg.fill("#spellIn", word.upper()); pg.tap("[data-act=check]")
    check("啱晒" in pg.inner_text("#qFeedback"), f"spelling accepts correct answer (case-insensitive): {word}")
    pg.tap("#qNext"); pg.fill("#spellIn", "zzzz"); pg.tap("[data-act=hint]"); shot(pg, "quiz-spelling")
    pg.tap("[data-act=check]")
    check("正確答案" in pg.inner_text("#qFeedback"), "spelling rejects wrong answer")
    check(pg.evaluate("accepts(byId('give-up-on')).has('give up') && accepts(byId('avoid-ing')).has('avoid')"), "alternative answers accepted (give up / avoid)")
    # --- quiz: multiple choice
    pg.evaluate("qz.phase='setup'; renderQuiz()"); pg.tap("#qType [data-v=mc]"); pg.tap("[data-act=go]"); pg.wait_for_timeout(200)
    n_opts = pg.locator("#mcOpts button").count()
    right = pg.evaluate("qz.items[0]"); pg.tap(f"#mcOpts [data-opt='{right}']")
    check(n_opts == 4 and "啱晒" in pg.inner_text("#qFeedback"), "MC: 4 options, correct choice marked right")
    shot(pg, "quiz-mc")
    # --- flashcards
    pg.tap("#nav [data-tab=cards]"); pg.tap("#flip"); pg.wait_for_timeout(500)
    check(pg.evaluate("$('#flip').classList.contains('on')"), "flashcard flips"); shot(pg, "flashcards")
    pg.tap("[data-act=next]"); check(f"第 2 / {NW} 張" in pg.inner_text("#tab-cards"), "flashcard next")
    # --- word bank + add word + TTS fallback
    pg.tap("#nav [data-tab=bank]"); pg.fill("#bkQ", "決心")
    check(pg.locator("#bkList li").count() == 1, "bank search by Chinese")
    pg.fill("#bkQ", ""); pg.tap("[data-act=add]")
    pg.fill("#aw", "ambitious"); pg.fill("#azh", "有野心嘅"); pg.select_option("#apos", "形容詞")
    pg.fill("#aipa", "/æmˈbɪʃəs/"); pg.fill("#aex", "She is very ambitious."); pg.fill("#aexzh", "佢好有野心。")
    pg.tap("[data-act=saveword]")
    check(pg.evaluate("allWords().length") == NW + 1, "custom word added")
    pg.locator("#bkList li[data-row^='u-'] [data-say=w]").tap()
    check(pg.evaluate("__tts.includes('ambitious')"), "custom word uses browser speechSynthesis fallback")
    shot(pg, "word-bank")
    # --- stats + export
    pg.tap("#nav [data-tab=stats]"); shot(pg, "stats"); pg.tap("[data-act=export]"); wait(pg, "document.querySelector('#exportBox').value.length>0")
    code = pg.input_value("#exportBox")
    check(code.startswith("V1z.") and len(code) < 3000, f"export code produced ({len(code)} chars)")
    shot(pg, "backup")
    pg.wait_for_timeout(500)
    # --- persistence across reload (localStorage or URL hash)
    pg.reload(); wait(pg, "window.__ready")
    check(pg.evaluate("Object.keys(S.p).length") == 10 and pg.evaluate("S.custom.length") == 1, f"progress survives reload via {mode}")
    if mode == "hash": check("#s=V1" in pg.url, "URL hash carries state")
    print("JS errors:", errs); check(not errs, "no JS errors")
    # --- fresh device, 2 days later: import code, check scheduling
    ctx2 = b.new_context(**IPHONE); ctx2.add_init_script(offset_script(2)); pg2 = ctx2.new_page()
    pg2.on("pageerror", lambda e: errs.append("ctx2: " + str(e)))
    pg2.goto(URL.split("#")[0]); wait(pg2, "window.__ready")
    check(pg2.evaluate("Object.keys(S.p).length") == 0, "new device starts empty")
    pg2.tap("#nav [data-tab=stats]"); pg2.fill("#importBox", code); pg2.tap("[data-act=import]"); wait(pg2, "Object.keys(S.p).length>0")
    check(pg2.evaluate("Object.keys(S.p).length") == 10 and pg2.evaluate("S.custom.length") == 1, "import restores progress + custom word")
    due = pg2.evaluate("dueList().map(w=>w.id)")
    check(len(due) == 10, f"2 days later: all 10 learned words are due ({len(due)})")
    check(pg2.evaluate("newLeftToday()") == 10, "2 days later: 10 new words allowed again")
    check(pg2.evaluate("streak()") == 0, "streak resets after a missed day")
    b.close()
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAIL(S): {fails}")

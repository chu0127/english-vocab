"""Inline src/*, words.json and audio/*.mp3 into dist/index.html."""
import base64, json, datetime, hashlib
from common import ROOT, load_words
words = load_words()
audio, missing = {}, []
for w in words:
    for kind, key in (("word", "w"), ("example", "e")):
        p = ROOT / "audio" / f"{w['id']}.{kind}.mp3"
        if p.exists():
            audio.setdefault(w["id"], {})[key] = "data:audio/mpeg;base64," + base64.b64encode(p.read_bytes()).decode()
        else:
            missing.append(f"{w['id']}.{kind}")
src = ROOT / "src"
html = (src / "index.template.html").read_text(encoding="utf-8")
_h = hashlib.sha1(json.dumps([words, sorted(audio)], ensure_ascii=False).encode() + (src / "app.js").read_bytes() + (src / "app.css").read_bytes() + html.encode()).hexdigest()[:12]
build = {"built": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "count": len(words), "id": _h}
def js(o): return json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
html = (html.replace("/*__CSS__*/", (src / "app.css").read_text(encoding="utf-8"))
            .replace("/*__APP__*/", (src / "app.js").read_text(encoding="utf-8"))
            .replace("/*__DATA__*/", f"const WORDS={js(words)};\nconst AUDIO={js(audio)};\nconst BUILD={js(build)};"))
out = ROOT / "dist" / "index.html"; out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
size = out.stat().st_size
print(f"built {out}  words={len(words)}  clips={sum(len(v) for v in audio.values())}  size={size/1024:.0f} KB")
if missing: print("沒有錄音（會用瀏覽器語音）:", ", ".join(missing))
if size > 10 * 1024 * 1024: print("⚠️  檔案超過 10 MB，手機載入會慢；htmldrop 上限 25 MB。")

"""Generate missing edge-tts clips: audio/<id>.word.mp3 and audio/<id>.example.mp3.
Usage: .venv/bin/python tools/gen_audio.py [--force ID ...]"""
import asyncio, sys, os
import edge_tts
from common import ROOT, load_words, say_text
VOICE, RATE = "en-GB-SoniaNeural", "-10%"
force = set(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == "--force" else set()

def compress_mp3(path):
    """Re-encode to 24 kbps mono to keep dist/index.html under ~8–10 MB."""
    import subprocess, tempfile
    tmp = path.with_suffix(".tmp.mp3")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-codec:a", "libmp3lame", "-b:a", "24k", "-ac", "1", "-ar", "24000", str(tmp)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if tmp.stat().st_size > 500:
            tmp.replace(path)
        elif tmp.exists():
            tmp.unlink()
    except Exception as e:
        print("  compress skip:", e)
        if tmp.exists():
            tmp.unlink()

async def tts(text, path):
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(path))
            if path.stat().st_size > 1000:
                compress_mp3(path)
                return True
        except Exception as e:
            print("  retry:", text, e)
        await asyncio.sleep(2)
    return False

async def main():
    adir = ROOT / "audio"; adir.mkdir(exist_ok=True)
    made = failed = 0
    for w in load_words():
        for kind, text in (("word", say_text(w)), ("example", w["example"])):
            p = adir / f"{w['id']}.{kind}.mp3"
            if p.exists() and w["id"] not in force: continue
            print(f"TTS {kind:7s} {w['id']}: {text}")
            if await tts(text, p): made += 1
            else: failed += 1; print("  FAILED (app will fall back to browser voice)")
    print(f"done: {made} new clip(s), {failed} failed")

asyncio.run(main())

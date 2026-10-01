import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
REQUIRED = ["word", "ipa", "pos", "zh", "example"]

def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")

def say_text(w):
    """Text the TTS should read for the headword (strips '(…)' brackets and '+ -ing')."""
    if w.get("say"): return w["say"]
    t = re.sub(r"\(([^)]*)\)", r"\1", w["word"])
    t = re.sub(r"\+\s*-?ing", "", t)
    return re.sub(r"\s+", " ", t).strip()

def load_words():
    data = json.loads((ROOT / "words.json").read_text(encoding="utf-8"))
    out, seen, errors = [], set(), []
    for li, les in enumerate(data["lessons"]):
        lesson = les.get("lesson") or f"Lesson {li+1}"
        added = les.get("added", "")
        for w in les["words"]:
            for k in REQUIRED:
                if not str(w.get(k, "")).strip():
                    errors.append(f"[{lesson}] '{w.get('word','?')}' 缺少欄位 {k}")
            w = dict(w)
            w["id"] = w.get("id") or slug(w["word"])
            w["lesson"] = w.get("lesson", lesson)
            w["added"] = w.get("added", added)
            if w["id"] in seen: errors.append(f"重複 id: {w['id']}")
            seen.add(w["id"])
            out.append(w)
    if errors:
        raise SystemExit("words.json 有問題：\n  " + "\n  ".join(errors))
    return out

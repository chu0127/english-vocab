# 點樣加新一課嘅生字（每次照做就得）

> **App 永久網址：https://chu0127.github.io/english-vocab/**（GitHub Pages，網址永遠唔變，進度自動存喺手機瀏覽器）
> Repo：https://github.com/chu0127/english-vocab

所有嘢都喺 box 嘅 `/workspace/vocab-app/` 入面：

| 檔案 | 用途 |
|---|---|
| `words.json` | **生字庫（唯一要手動改嘅檔案）** |
| `audio/` | edge-tts 錄音（`<id>.word.mp3`、`<id>.example.mp3`），自動生成 |
| `src/` | App 原始碼（`app.js`、`app.css`、`index.template.html`） |
| `tools/gen_audio.py` | 幫未有錄音嘅字生成錄音（en-GB-SoniaNeural） |
| `tools/build.py` | 將所有嘢砌埋做一個 `dist/index.html` |
| `tools/test_app.py` | 自動測試（iPhone 大細、SRS、測驗、備份…） |
| `tools/publish.sh` | **預設發佈**：建置 → commit → push 去 GitHub → 等 Pages 上線（同一個網址） |
| `tools/publish_pages.sh` | `publish.sh` 實際做嘢嘅腳本 |
| `tools/publish_htmldrop.sh` | 舊方法（htmldrop.link，每次新網址、30 日到期），唔使再用 |
| `index.html`（repo 根目錄） | GitHub Pages 用嘅檔案，由 `publish.sh` 自動由 `dist/index.html` 複製 |

---

## 快速版（4 步）

```bash
cd /workspace/vocab-app
# 1. 改 words.json（喺 "lessons" 最尾加一課，見下面範例）
# 2. 生成錄音 + 建置
.venv/bin/python tools/gen_audio.py && .venv/bin/python tools/build.py
# 3. 測試（見到 RESULT: ALL PASS 先好發佈）
.venv/bin/python tools/test_app.py file:///workspace/vocab-app/dist/index.html
# 4. 發佈去 GitHub Pages（同一個網址；等 1–3 分鐘）
./tools/publish.sh "Add Lesson 2 · My Hometown"
```

## 第 1 步：喺 `words.json` 加一課

喺 `"lessons": [ ... ]` 入面，喺最後一課後面加逗號，再加一個新物件。每個字一行：

```json
    {
      "lesson": "Lesson 2 · My Hometown 作文",
      "added": "2026-10-08",
      "words": [
        { "word": "ambitious", "ipa": "/æmˈbɪʃəs/", "pos": "形容詞", "zh": "有野心嘅", "example": "She is very ambitious.", "example_zh": "佢好有野心。" },
        { "word": "look forward to", "ipa": "/ˌlʊk ˈfɔːwəd tə/", "pos": "片語", "zh": "期待", "example": "I look forward to the trip.", "example_zh": "我好期待呢個旅程。", "accept": ["look forward"] }
      ]
    }
```

欄位：

| 欄位 | 必填？ | 說明 |
|---|---|---|
| `word` | ✅ | 英文生字／片語 |
| `ipa` | ✅ | 音標，**統一用英式 (British / RP)**，例如 `/ədˈmaɪə/` |
| `pos` | ✅ | 詞性：名詞、動詞、形容詞、副詞、片語、名詞片語、連接詞、介詞… |
| `zh` | ✅ | 中文意思 |
| `example` | ✅ | 英文例句 |
| `example_zh` | 選填 | 例句廣東話翻譯 |
| `id` | 選填 | 唔填就自動由 `word` 生成（例如 `look-forward-to`）。**一旦發佈咗就唔好改 `id` 或者改 `word` 嘅串法**，因為進度係靠 id 對應；真係要改串法，就手動寫返舊 id 落 `"id"`。 |
| `say` | 選填 | 想錄音讀嘅文字同 `word` 唔同時用，例如 `"word": "avoid + -ing", "say": "avoid"` |
| `accept` | 選填 | 默書時額外接受嘅答案，例如 `["give up", "give up on"]` |
| `lesson` / `added` | 選填 | 通常寫喺課嘅層面；個別字可以覆蓋 |

小心：JSON 要用英文雙引號 `"`，每項之間要有逗號，最後一項後面**唔可以**有逗號。`build.py` 會檢查缺欄位同重複 id，有錯會講你知邊個字。

## 第 2 步：錄音 + 建置

```bash
.venv/bin/python tools/gen_audio.py      # 只會錄未有嘅（每個字約 3 秒）
.venv/bin/python tools/build.py          # 輸出 dist/index.html 同檔案大小
```

- 改咗例句想重錄：`.venv/bin/python tools/gen_audio.py --force <id> <id2>`
- 如果 edge-tts 連唔到網，個字照樣可以用：App 會自動用手機／瀏覽器內置英文語音（en-GB）。
- 大小參考：每個字（生字 + 例句兩段錄音）大約加 **35 KB**。100 個字 ≈ 3.5 MB，300 個字 ≈ 10 MB（`build.py` 超過 10 MB 會警告；GitHub 單一檔案上限 100 MB，但太大手機會載得慢）。太大時可以考慮將舊課分拆另一個 App。

## 第 3 步：測試

```bash
.venv/bin/python tools/test_app.py file:///workspace/vocab-app/dist/index.html --shots   # --shots 會更新 preview/*.png
# 模擬 htmldrop（封鎖 localStorage）：
.venv/bin/python tools/serve_csp.py 8766 &   # 開一次就得
.venv/bin/python tools/test_app.py http://127.0.0.1:8766/index.html
```

測試會自動跟字庫數目（要求每個字都有 2 段錄音；如果有字錄音失敗，嗰項會 ✗，但 App 照用得，會用瀏覽器語音）。最尾見到 `RESULT: ALL PASS` 就可以發佈。

## 第 4 步：發佈（GitHub Pages，網址永遠唔變）

```bash
./tools/publish.sh "Add Lesson 2 · My Hometown"     # commit 訊息可以唔寫
```

腳本會：重新建置 → 將 `dist/index.html` 複製做 repo 根目錄嘅 `index.html` → `git commit` → `git push` 去
`chu0127/english-vocab` 嘅 `main` → 每 10 秒檢查網站，直到見到新版本先話「✅ 已上線」。

- **Pages 部署要時間**：通常 1–3 分鐘，間中 10 分鐘。GitHub CDN 會 cache 最多 10 分鐘，
  手機見到舊版就落拉重新整理（或者喺網址後面加 `?v=2`）。
- 網址唔變，**進度唔會唔見**（存喺手機瀏覽器 localStorage）。唔使匯出／匯入。
- 上線之後可以用測試腳本試真網站：
  `.venv/bin/python tools/test_app.py https://chu0127.github.io/english-vocab/ --expect-ls`
- 需要 box 上 `gh` 仲係登入緊 `chu0127`（`gh auth status`）。如果登出咗，push 會失敗，重新 `gh auth login` 就得。
- 唔會 commit 嘅嘢（見 `.gitignore`）：`.venv/`、`audio/`（錄音已經內嵌喺 `index.html`；原始 mp3 只留喺 box）、`dist/`、`preview/`、`publish/`。
  如果 box 嘅 `audio/` 唔見咗，`gen_audio.py` 會自動重新錄過。

### 備份／換機

- 換手機或者清咗瀏覽器資料之前：App →「進度」→「📤 匯出進度碼」→ 複製保存；新機開同一個網址 →「📥 匯入進度碼」。
- 以前喺 htmldrop 版本用開嘅進度，一樣係用「匯出進度碼 → 匯入」搬過嚟（已測試可以用）。

### （舊）htmldrop.link

`./tools/publish_htmldrop.sh` 仲用得，但每次都係新網址、30 日到期、唔可以用 localStorage（進度只記喺網址 `#s=…`），
所以而家唔建議用。

## 其他

- 喺 GitHub Pages、電腦或者其他正常網站開，進度會自動存喺瀏覽器 localStorage；只有 htmldrop 呢類封鎖儲存嘅網站先會出黃色提示同用網址 `#s=…` 記進度。
- SRS 規則（`src/app.js` 嘅 `IV`）：第 1–7 級分別隔 1、2、4、7、15、30、60 日；
  記得 → 升一級；有啲唔確定 → 降一級、聽日再溫；唔記得 → 返第 1 級、今次再出、聽日再溫。
  每日新字數喺「進度 → 設定」改（預設 10）。

# 海選 — 上線步驟

整個 `haixuan` 資料夾原封不動丟上 GitHub 就能用。
`後端設定/` 已經被 `.gitignore` 擋掉，不會跟著上傳（裡面是答案）。

---

## 第 1 步　放音檔

在 `haixuan/` 執行：

```bash
python 後端設定/準備音檔.py
```

96 個 mp3 會出現在 `audio/`（16 人 × 6 階段），檔名是雜湊過的，看不出是誰。
它讀的是 `newvoice/音檔需求_16人.csv`，缺什麼會直接列出來。

還缺的先補：

```bash
python 批次渲染.py          # 依 渲染清單_16人_補.csv，23 條 DiffSinger
# Mureka 那 16 次生成完，檔案放 gary/選定/<候選人>_<階段>.mp3
```

**還沒渲染完也沒關係** —— 先跳過這步，遊戲照樣能玩，只是沒聲音。

---

## 第 2 步　上傳 GitHub

```bash
cd haixuan
git init
git add .
git commit -m "海選"
git branch -M main
git remote add origin https://github.com/rickyyenli-eng/haixuan.git
git push -u origin main
```

然後到 repo 的 **Settings → Pages**，Source 選 `main` / `(root)`，儲存。

一兩分鐘後開 `https://rickyyenli-eng.github.io/haixuan/`

**到這裡就能玩了。** 只是還沒有後端，所以是離線模式：NPC 用隨機值，結算沒有相關係數。

---

## 第 3 步　建試算表

1. 開一份新的 Google 試算表，把左下角的工作表改名為 **候選人**
2. 用記事本打開 `後端設定/貼進Sheet_候選人真值.csv`，全選複製（16 人 20 欄，欄位跟 v1 不一樣，整張換掉）
3. 貼到試算表的 A1
4. 網址列中間那段就是 SHEET_ID：
   `docs.google.com/spreadsheets/d/`**`這一段`**`/edit`

---

## 第 4 步　建後端

1. 在試算表裡：**擴充功能 → Apps Script**
2. 把 `後端設定/後端_AppsScript.gs` 的內容整個貼上去（覆蓋原本的）
3. 改最上面兩行：

```js
const SHEET_ID  = '第 3 步複製的那一段';
const WRITE_KEY = '自己想一組密碼，例如 haixuan-2026-x7k';
```

4. 存檔 → **部署 → 新增部署作業**
   - 類型選 **網頁應用程式**
   - 執行身分：**我**
   - 誰可以存取：**任何人**
   - 按部署，第一次會要你授權，照著點下去
5. 複製「網頁應用程式」的網址（長得像 `https://script.google.com/macros/s/AKfy…/exec`）

---

## 第 5 步　接起來

打開 `config.js`，填兩行：

```js
const CLOUD_URL = "第 4 步複製的網址";
const CLOUD_WRITE_KEY = "第 4 步設的那組密碼";
```

存檔，push 上去：

```bash
git add config.js && git commit -m "接後端" && git push
```

重新整理網站，開場畫面那行紅字消失就是接上了。

---

## 完成後

玩過的每一局會寫進試算表的 **紀錄** 工作表：轉身額度怎麼花的、平均幾秒轉、說服命中、
PK 選了哪些題目、決選之夜的排序、三個相關係數、冠軍、完整原始資料。那是你之後看玩家偏好的資料來源。

---

## 常見狀況

| 狀況 | 原因 |
|---|---|
| 開場有紅字「離線模式」 | `config.js` 沒填，或網址打錯 |
| 沒有聲音 | `audio/` 是空的或不齊，跑第 1 步 |
| 有些關卡沒聲音 | 那些音檔還沒渲染／生成，`準備音檔.py` 會列出缺哪些 |
| 歌詞跟不上 | gary 那五首（留燈／副駕駛／失速／壞習慣／今天天氣很好）目前是等比例估算，要用耳朵校一次 |
| 結算沒有相關係數 | 同上，後端沒接上 |
| Apps Script 說沒權限 | 部署時「誰可以存取」要選**任何人** |
| 改了 config.js 沒生效 | GitHub Pages 有快取，等一分鐘或強制重整 |

---

## 不要上傳的東西

`後端設定/` 整個資料夾——裡面是答案（誰在意什麼、哪個選項會說中）
和你的 SHEET_ID。`.gitignore` 已經擋掉了，但自己也留意一下。

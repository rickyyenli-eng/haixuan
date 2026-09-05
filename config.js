/* 海選 — 後端設定
   1. 建一份 Google 試算表，工作表命名為「候選人」，把 貼進Sheet_候選人真值.csv 貼進去
   2. 擴充功能 → Apps Script，貼上 後端_AppsScript.gs，填 SHEET_ID 和 WRITE_KEY
   3. 部署 → 網頁應用程式（執行身分：我／存取：任何人），把網址填在下面
   4. CLOUD_WRITE_KEY 要跟 Apps Script 裡的 WRITE_KEY 一模一樣
   留空的話遊戲會用離線模式：能玩，但沒有相關係數。 */
const CLOUD_URL = "https://script.google.com/macros/s/AKfycbwqG1PGMuWee4cmaJdmdZzJq4F7bufiy_HNXMaoDzdWQo3OHFhMLI5cSJX_3EhxOSGnTw/exec";
const CLOUD_WRITE_KEY = "orangeba";

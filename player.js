/* ==========================================================================
   海選 · 學員模式
   你不是導師，你是台上那個人。手機錄自己的聲音，電腦客觀評分。
   錄音只存在這台裝置的瀏覽器裡（IndexedDB），不會上傳。
   ========================================================================== */

/* 每首歌有男聲、女聲兩個母帶。伴奏、歌詞時間軸、音高參考都跟著同一個 hash 走。 */
const MASTER = {
  "01_留燈":{"男":"e22b16eefe","女":"0c294d622a"},
  "02_伴唱":{"男":"0b019d2b67","女":"a10188fad5"},
  "02_副駕駛":{"男":"21d2a6e50c","女":"cf0cf54f71"},
  "03_失速":{"男":"3ae91f0bac","女":"5a5013cafc"},
  "04_壞習慣":{"男":"fed2f3fc18","女":"d8dd37d1f5"},
  "05_今天天氣很好":{"男":"5cec1abe08","女":"8065f3d460"},
  "06_還沒冷":{"男":"4f3ce229a1","女":"5042ed40e7"},
  "07_自轉":{"男":"4b72340a14","女":"2e011737c6"},
  "01_風向":{"男":"f7bb056b02","女":"ff7edbaa03"},
  "03_定影":{"男":"abe7789569","女":"743571ca82"},
  "04_繞路":{"男":"c03eb200f5","女":"15094dd7b7"},
  "05_會客時間":{"男":"c712bb1824","女":"f7121c4b3b"}
};
const mhash = (k, g) => (MASTER[k] && MASTER[k][g]) || (MASTER[k] && (MASTER[k]["男"] || MASTER[k]["女"]));
const hasVoice = (k, g) => !!(MASTER[k] && MASTER[k][g]);
const BKURL = h => "audio/bk/" + h + ".mp3";        // 只有伴奏
const EXTRA = new Set(["d8dd37d1f5"]);               // 只為了練歌室生的導唱，不是比賽音檔
const MIXURL = h => EXTRA.has(h) ? "audio/gv/" + h + ".mp3" : "audio/" + h + ".mp3";
const BLIND_POOL = ["01_留燈","02_伴唱","02_副駕駛","03_失速","04_壞習慣","05_今天天氣很好","06_還沒冷","07_自轉"];
const HOMES = ["台北","新北","基隆","桃園","新竹","苗栗","台中","彰化","南投","雲林",
               "嘉義","台南","高雄","屏東","宜蘭","花蓮","台東","澎湖","金門","馬祖"];
const KEYNAME = k => k === 0 ? "原 key" : (k > 0 ? "+" + k : String(k));
const SONGHINT = {
  "01_留燈":"慢板 city pop・68 拍・懷舊，中段有薩克斯風",
  "02_伴唱":"R&B 靈魂樂・88 拍・轉音多，最後一段升八度",
  "02_副駕駛":"中板 city pop・92 拍・夜路的感覺",
  "03_失速":"台式獨立搖滾・168 拍・快、急，中間有大停頓",
  "04_壞習慣":"慢搖滾・72 拍・前段乾淨、後段整個爆開",
  "05_今天天氣很好":"明亮的 city pop・116 拍・輕快",
  "06_還沒冷":"復古台式抒情・92 拍・整首壓在低音域，只有最後一句升八度",
  "07_自轉":"迷幻搖滾・96 拍・從小聲一路堆到破音牆",
  "01_風向":"電子 hyperpop・152 拍・真假音交界",
  "03_定影":"鋼琴抒情・84 拍・長音、弱聲，橋段清唱",
  "04_繞路":"City pop funk・104 拍・咬字密、大跳音程",
  "05_會客時間":"大抒情・72 拍・壓著唱再放開，長高音"
};

/* ---------- 錄音倉庫（只在這台裝置） ---------- */
const REC = (() => {
  let db = null;
  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open("hx_rec", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("takes");
    r.onsuccess = () => { db = r.result; res(db) };
    r.onerror = () => rej(r.error);
  });
  const mem = {};                       // 存不進去（無痕模式）就先放記憶體，至少這一局能玩完
  return {
    async put(k, blob) { mem[k] = blob;
      try { const d = await open(); await new Promise((res, rej) => {
        const t = d.transaction("takes", "readwrite"); t.objectStore("takes").put(blob, k);
        t.oncomplete = res; t.onerror = () => rej(t.error) }) } catch (e) { REC.blocked = true } },
    async get(k) { try { const d = await open(); return await new Promise((res, rej) => {
        const q = d.transaction("takes", "readonly").objectStore("takes").get(k);
        q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error) }) }
      catch (e) { REC.blocked = true; return mem[k] || null } },
    async keys() { const out = new Set(Object.keys(mem));
      try { const d = await open(); const ks = await new Promise((res, rej) => {
        const q = d.transaction("takes", "readonly").objectStore("takes").getAllKeys();
        q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error) });
        ks.forEach(k => out.add(k)) } catch (e) {}
      return [...out] },
    async wipe() { for (const k of Object.keys(mem)) delete mem[k];
      try { const d = await open(); await new Promise(res => {
        const t = d.transaction("takes", "readwrite"); t.objectStore("takes").clear(); t.oncomplete = res }) } catch (e) {} }
  };
})();
const takeURLs = {};
async function takeURL(stage) {
  if (takeURLs[stage]) return takeURLs[stage];
  const b = await REC.get("take_" + stage);
  if (!b) return null;
  return (takeURLs[stage] = URL.createObjectURL(b));
}

/* ---------- 音高參考：base64 → 半音序列（-1 = 沒有聲音） ---------- */
const refCache = {};
function refPitch(hash) {
  if (refCache[hash]) return refCache[hash];
  const s = (typeof PITCHREF !== "undefined") && PITCHREF[hash];
  if (!s) return null;
  const bin = atob(s), a = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) { const v = bin.charCodeAt(i); a[i] = v ? (v - 1) / 4 + 30 : -1 }
  return (refCache[hash] = a);
}

/* ---------- YIN 音高偵測（8kHz，40ms 一格） ---------- */
const SR = 8000, HOP = 320, WIN = 512, TMIN = 8, TMAX = 110;
function yinAt(buf, off) {
  const half = WIN >> 1, d = new Float32Array(TMAX + 2);
  for (let tau = TMIN; tau <= TMAX; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) { const x = buf[off + i] - buf[off + i + tau]; s += x * x }
    d[tau] = s;
  }
  let run = 0, best = -1, cm = new Float32Array(TMAX + 2);
  for (let tau = TMIN; tau <= TMAX; tau++) { run += d[tau]; cm[tau] = d[tau] * (tau - TMIN + 1) / (run || 1e-9) }
  for (let t = TMIN + 1; t < TMAX; t++) if (cm[t] < 0.15) { while (t + 1 < TMAX && cm[t + 1] < cm[t]) t++; best = t; break }
  if (best < 0) { let b = TMIN + 1; for (let t = TMIN + 1; t < TMAX; t++) if (cm[t] < cm[b]) b = t;
    if (cm[b] > 0.55) return -1; best = b }
  const a = cm[best - 1], b2 = cm[best], c = cm[best + 1] || b2;
  const sh = (a - c) / (2 * (a - 2 * b2 + c) || 1e-9);
  const f = SR / (best + (isFinite(sh) ? Math.max(-1, Math.min(1, sh)) : 0));
  return (f > 70 && f < 1000) ? 69 + 12 * Math.log2(f / 440) : -1;
}
async function trackPitch(pcm, onProg) {
  const n = Math.max(0, Math.floor((pcm.length - WIN - TMAX) / HOP));
  const out = new Float32Array(n);
  // 有聲門檻：先算每格能量
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0, o = i * HOP;
    for (let j = 0; j < WIN; j++) { const x = pcm[o + j]; s += x * x } rms[i] = Math.sqrt(s / WIN) }
  // 有沒有在唱：跟這段錄音自己的「大聲」比，不是跟中位數比
  // （整首都在唱的人，中位數就是唱歌的音量，用中位數當門檻會把自己全部濾掉）
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const thr = Math.max(sorted[Math.floor(n * 0.95)] * 0.10, 0.006);
  for (let i = 0; i < n; i++) {
    out[i] = rms[i] < thr ? -1 : yinAt(pcm, i * HOP);
    if ((i & 255) === 0) { if (onProg) onProg(i / n); await new Promise(r => setTimeout(r, 0)) }
  }
  // 中位數平滑，去掉單格跳八度
  const sm = Float32Array.from(out);
  for (let i = 1; i < n - 1; i++) {
    const w = [out[i - 1], out[i], out[i + 1]].filter(x => x > 0);
    sm[i] = w.length >= 2 ? w.sort((a, b) => a - b)[Math.floor(w.length / 2)] : out[i];
  }
  return sm;
}
async function blobToPCM(blob) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  const src = buf.getChannelData(0), ratio = buf.sampleRate / SR;
  const n = Math.floor(src.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {           // 先做簡單低通再取樣
    const a = Math.floor(i * ratio), b = Math.min(src.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let k = a; k < b; k++) s += src[k];
    out[i] = b > a ? s / (b - a) : 0;
  }
  ac.close();
  return out;
}

/* ---------- 三個客觀分 ---------- */
async function analyzeTake(blob, hash, keyShift, onProg) {
  const KS = keyShift || 0;
  const ref0 = refPitch(hash);
  const ref = ref0 ? Float32Array.from(ref0, v => v > 0 ? v + KS : -1) : null;
  const pcm = await blobToPCM(blob);
  const you = await trackPitch(pcm, onProg);
  if (!ref) return { pitch: 0, rhythm: 0, complete: 0, Q: 0, err: "沒有這首歌的音高參考" };

  /* 1) 對齊：找一個整體時間位移（±1 秒），先用「有沒有出聲」抓大概 */
  const n = Math.min(ref.length, you.length + 25);
  const order = [0]; for (let k = 1; k <= 25; k++) { order.push(-k); order.push(k) }
  let bestOff = 0, bestHit = -1;
  for (const off of order) {                       // 從 0 開始往外找，平手時用比較小的位移
    let hit = 0;
    for (let i = 0; i < n; i += 2) { const j = i + off;
      if (j < 0 || j >= you.length) continue;
      if (ref[i] > 0 && you[j] > 0) hit++;
    }
    if (hit > bestHit) { bestHit = hit; bestOff = off }
  }
  /* 再用「音高對不對得上」在附近微調（八度先不管，取最好的那一種） */
  const agree = (off) => {
    let best = 0;
    for (const oct of [-24, -12, 0, 12, 24]) {
      let ok = 0;
      for (let i = 0; i < n; i++) { const j = i + off;
        if (j < 0 || j >= you.length) continue;
        if (ref[i] > 0 && you[j] > 0 && Math.abs(you[j] + oct - ref[i]) <= 0.5) ok++;
      }
      if (ok > best) best = ok;
    }
    return best;
  };
  {
    let bo = bestOff, bv = agree(bestOff);
    for (let d = 1; d <= 4; d++) for (const off of [bestOff - d, bestOff + d]) {
      const v = agree(off); if (v > bv) { bv = v; bo = off }
    }
    bestOff = bo;
  }
  /* 2) 八度：只允許整個八度平移，不准整體走音 */
  let bestOct = 0, bestAcc = -1;
  for (const oct of [-24, -12, 0, 12, 24]) {
    let ok = 0, tot = 0;
    for (let i = 0; i < n; i++) { const j = i + bestOff;
      if (j < 0 || j >= you.length) continue;
      if (ref[i] > 0 && you[j] > 0) { tot++; if (Math.abs(you[j] + oct - ref[i]) <= 0.5) ok++ }
    }
    const acc = tot ? ok / tot : 0;
    if (acc > bestAcc) { bestAcc = acc; bestOct = oct }
  }
  const pitch = Math.round(bestAcc * 100);

  /* 3) 完整度：參考有唱的地方，你有沒有出聲 */
  let refV = 0, both = 0;
  for (let i = 0; i < n; i++) { const j = i + bestOff;
    if (ref[i] > 0) { refV++;
      if (j >= 0 && j < you.length && (you[j] > 0 || (you[j - 1] > 0) || (you[j + 1] > 0))) both++ } }
  const complete = refV ? Math.round(both / refV * 100) : 0;

  /* 4) 節奏：每一句的起唱點差多少 */
  const L = (typeof LYRICS !== "undefined") && LYRICS[hash];
  let rhythm = 0;
  if (L && L.length) {
    let sum = 0;
    for (const ln of L) {
      const f0 = Math.max(0, Math.round((ln[0] - 0.5) / 0.04)), f1 = Math.round(ln[1] / 0.04);
      let rOn = -1, yOn = -1;
      for (let i = f0; i <= f1 && i < ref.length; i++) if (ref[i] > 0) { rOn = i; break }
      for (let i = f0; i <= f1; i++) { const j = i + bestOff;
        if (j >= 0 && j < you.length && you[j] > 0) { yOn = i; break } }
      if (rOn < 0) { sum += 1; continue }               // 參考自己就沒唱，不扣分
      if (yOn < 0) continue;                             // 你整句沒出聲 → 0
      sum += Math.max(0, 1 - Math.abs(yOn - rOn) * 0.04 / 0.8);
    }
    rhythm = Math.round(sum / L.length * 100);
  }
  /* 節奏跟完整度對「跟著伴奏唱」的人幾乎是送分（96~98 / 100），
     舊公式 0.5/0.3/0.2 等於 Q ≈ 音準/2 + 49，整條尺被壓在 50~92 之間。
     改成音準為主、完整度當係數，讓這個模式跟自由模式落在同一把尺上——
     84 分在兩邊才是同一件事。前面幾關的難度沒有變，見 playerScore 的註解。 */
  const Q = Math.round((pitch * 0.70 + rhythm * 0.30) * (0.6 + 0.4 * complete / 100));
  return { pitch, rhythm, complete, Q, off: bestOff * 0.04, oct: bestOct };
}

/* ==========================================================================
   自由模式：沒有參考旋律，只聽你唱歌的基本功
     音準   音有沒有落在半音格上
     律動   有沒有一個穩定的脈動在跑、該用力的地方有沒有用力
     穩     長音撐不撐得住（音高會不會漂、音量會不會忽大忽小）
     完成度 唱了多久、用到多寬的音域
   ========================================================================== */
const FSR = 8000, FHOP = 80, FWIN = 400;          // 10ms 一格
const med = a => { const b = Array.from(a).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0 };
const cl01 = x => Math.max(0, Math.min(1, x));
function envFlux(pcm) {
  const n = Math.max(0, Math.floor((pcm.length - FWIN) / FHOP));
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0, o = i * FHOP;
    for (let j = 0; j < FWIN; j++) { const x = pcm[o + j]; s += x * x } e[i] = Math.sqrt(s / FWIN) }
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = Math.max(0, Math.log1p(e[i] * 80) - Math.log1p(e[i - 1] * 80));
  return { e, d };
}
/* 脈動清晰度：起音強度的自相關。在 0.25~2 秒之間找最強的週期。
   拍子鬆一點沒關係，只要「有一個律動一直在」就抓得到。 */
/* 分成 25 秒一段各量一次，取偏高的那一段（第 75 百分位）。
   問的是「你在律動的時候律動有多強」，而不是「整段平均起來如何」——
   不然同一個人同一首歌，抓到前奏或抓到副歌會差到 40 分。 */
function pulseWindowed(d) {
  // 25 秒一段；錄得短的話把窗縮小，至少要切得出三段，不然短錄音會被不公平地低估
  let W = 2500;
  if (d.length < 3 * W) W = Math.max(1200, Math.floor(d.length / 3));
  const H = Math.max(1, Math.floor(W / 2));
  if (d.length < W * 1.5) return pulseClarity(d);
  const vs = [];
  for (let a = 0; a + W <= d.length; a += H) vs.push(pulseClarity(d.subarray(a, a + W)));
  if (!vs.length) return pulseClarity(d);
  vs.sort((x, y) => x - y);
  return vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.75))];
}
function pulseClarity(d) {
  const n = d.length; if (n < 600) return 0;
  let m = 0; for (const v of d) m += v; m /= n;
  const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = d[i] - m;
  let e0 = 0; for (const v of x) e0 += v * v;
  if (!e0) return 0;
  let best = 0;
  for (let L = 25; L <= 200; L++) {
    let s = 0; for (let i = 0; i + L < n; i++) s += x[i] * x[i + L];
    const r = s / e0; if (r > best) best = r;
  }
  return Math.max(0, best);
}
function segNotes(you) {
  const notes = []; let i = 0;
  while (i < you.length) {
    if (you[i] <= 0) { i++; continue }
    let j = i + 1, acc = [you[i]], m = you[i];
    while (j < you.length && you[j] > 0 && Math.abs(you[j] - m) < 0.8) {
      acc.push(you[j]); if (acc.length % 4 === 0) m = med(acc); j++;
    }
    if (j - i >= 6) {                       // 至少 240ms 才算一個音
      const p = med(acc);
      let v = 0; for (const x of acc) v += (x - p) * (x - p);
      const third = Math.max(1, Math.floor(acc.length / 3));
      const drift = Math.abs(med(acc.slice(-third)) - med(acc.slice(0, third)));
      notes.push({ s: i, e: j, n: j - i, p, sd: Math.sqrt(v / acc.length), drift, acc });
    }
    i = j;
  }
  return notes;
}
/* 音準：每個音的中心離最近的半音格多遠。整體偏一點不罰（每個人的基準音高不同），飄來飄去才罰。 */
function freePitchScore(notes) {
  if (!notes.length) return 0;
  const tau = med(notes.map(o => o.p - Math.round(o.p)));
  let num = 0, den = 0;
  for (const o of notes) {
    const q = o.p - tau;
    const cents = Math.abs(q - Math.round(q)) * 100;
    num += cl01(1 - cents / 45) * o.n; den += o.n;
  }
  return Math.round(100 * num / (den || 1));
}
/* 律動：脈動清晰度 + 動態對比（該用力的地方有沒有用力） */
function freeGrooveScore(e, d, notes) {
  // 只取第一個音到最後一個音之間，前後的沉默和前奏不要拿來稀釋
  let seg = d;
  if (notes.length) {
    const a = Math.max(0, notes[0].s * 4 - 100);
    const b = Math.min(d.length, notes[notes.length - 1].e * 4 + 100);
    if (b - a > 600) seg = d.subarray(a, b);
  }
  const p = pulseWindowed(seg);
  const pulse = cl01((p - 0.06) / 0.17);      // 白噪音 0.06、拍子很鬆 0.09、唱得穩 0.20 以上
  let dyn = 0;
  if (notes.length >= 10) {
    const pk = notes.map(o => { let m = 0;
      for (let i = o.s * 4; i < o.e * 4 && i < e.length; i++) m = Math.max(m, e[i]);
      return 20 * Math.log10(m + 1e-6) });
    const q = pk.slice().sort((a, b) => a - b);
    const db = q[Math.floor(q.length * 0.9)] - q[Math.floor(q.length * 0.1)];
    dyn = db <= 1.5 ? 0 : db <= 5 ? (db - 1.5) / 3.5 : db <= 22 ? 1 : cl01(1 - (db - 22) / 10);
  }
  return { score: Math.round(100 * (0.55 * pulse + 0.45 * dyn)), pulse: p };
}
/* 穩：長音（0.4 秒以上）撐不撐得住。音高會不會一路漂掉、音量會不會忽大忽小。
   顫音不算漂——漂是拿前三分之一跟後三分之一比。 */
function freeSteadyScore(e, notes) {
  const long = notes.filter(o => o.n >= 10);
  if (long.length < 4) return 0;
  let num = 0, den = 0;
  for (const o of long) {
    const lv = [];
    for (let i = o.s * 4; i < o.e * 4 && i < e.length; i++) lv.push(Math.log1p(e[i] * 80));
    let mu = 0; for (const x of lv) mu += x; mu /= (lv.length || 1);
    let vv = 0; for (const x of lv) vv += (x - mu) * (x - mu);
    const lsd = Math.sqrt(vv / (lv.length || 1));
    num += (0.6 * cl01(1 - o.drift / 1.2) + 0.4 * cl01(1 - lsd / 0.6)) * o.n;
    den += o.n;
  }
  return Math.round(100 * num / (den || 1));
}
function freeBodyScore(notes) {
  if (!notes.length) return 0;
  const sec = notes.reduce((a, o) => a + o.n, 0) * 0.04;
  const ps = notes.map(o => o.p).sort((a, b) => a - b);
  const range = ps[Math.floor(ps.length * 0.95)] - ps[Math.floor(ps.length * 0.05)];
  return Math.round(100 * (0.6 * Math.min(1, sec / 60) + 0.4 * Math.min(1, range / 12)));
}
async function freeAnalyze(pcmOrBlob, onProg) {
  const pcm = (pcmOrBlob instanceof Float32Array) ? pcmOrBlob : await blobToPCM(pcmOrBlob);
  const { e, d } = envFlux(pcm);
  const you = await trackPitch(pcm, onProg);
  const notes = segNotes(you);
  const pitch = freePitchScore(notes);
  const g = freeGrooveScore(e, d, notes);
  const steady = freeSteadyScore(e, notes);
  const body = freeBodyScore(notes);
  const sec = Math.round(notes.reduce((a, o) => a + o.n, 0) * 0.04);
  let Q = Math.round(pitch * 0.40 + g.score * 0.25 + steady * 0.15 + body * 0.20);
  // 唱不到 30 秒不算一次完整的表演，直接打折，免得唱三句就想拿高分
  const shortBy = sec < 30 ? sec / 30 : 1;
  Q = Math.round(Q * shortBy);
  return { pitch, groove: g.score, steady, body, Q, notes: notes.length, sec,
           pulse: g.pulse, short: shortBy < 1 };
}

/* ---------- 評分模型（跟導師模式同一套公式，玩家多一個 Δ 修正） ---------- */
const RURAL = h => h && h !== "台北" && h !== "新北";
function npcScoreLocal(coach, strain, story, rural) {
  let s = 6.5;
  if (coach === "老派技術控") s += (2 - strain) * 0.9;
  if (coach === "情緒派") s += (strain - 1) * 0.6 + 0.5;
  if (coach === "市場派") s += (story ? 1.1 : -0.4);
  if (coach === "鄉土派") s += (rural ? 0.9 : -0.3) + (strain - 1) * 0.2;
  return Math.max(1, Math.min(10, s + (Math.random() - 0.5)));
}
function playerScore(res, heard, order) {
  /* 換尺後 72/30 等價於 65/38（新尺 ×0.79 + 20.6 = 舊尺），
     所以盲選 / PK / 決選之夜的難度跟換尺前一模一樣。 */
  const Q = res.Q, D = Math.max(-1.3, Math.min(1.3, (Q - 65) / 38 * 1.3));
  const strain = Math.max(0, Math.min(4, 4 - res.pitch / 25));
  const rural = RURAL(PM.home);
  const npcs = NPCLIST().map(x => npcScoreLocal(x, strain, true, rural));
  const judge = Math.max(1, Math.min(10, npcs.reduce((a, b) => a + b, 0) / npcs.length + D));
  const aud = Math.max(1, Math.min(10,
    7 - (heard || 0) * 0.3 - ((order || 8) - 1) * 0.05 + 0.4 - Math.abs(strain - 1) * 0.3 + D * 0.5));
  return { npcs, judge, aud, total: judge * 0.5 + aud * 0.5, D, strain };
}

/* ---------- 學員狀態 ---------- */
const PM = { on: false, free: false, me: null, name: "", home: "", say: "", voice: "男",
             song: {}, res: {}, mhash: {}, key: {}, title: {}, log: [], last: null };
function pmReset() { PM.on = false; PM.free = false; PM.me = null; PM.name = ""; PM.home = ""; PM.say = ""; PM.voice = "男";
  PM.song = {}; PM.res = {}; PM.mhash = {}; PM.key = {}; PM.title = {}; PM.log = [];
  PM.last = null; PM.out = null; PM.outAlive = null; PM.nightPos = null; PM.freeChamp = false; PM.coach = null;
  PM.rescued = null }
function pmSave() { return { on: PM.on, free: PM.free, me: PM.me, name: PM.name, home: PM.home, say: PM.say,
  voice: PM.voice, song: PM.song, res: PM.res, mhash: PM.mhash, key: PM.key, title: PM.title,
  log: PM.log || [], out: PM.out || null, outAlive: PM.outAlive || null, nightPos: PM.nightPos || null,
  coach: PM.coach || null, rescued: PM.rescued || null, freeChamp: !!PM.freeChamp } }
function pmLoad(o) { if (o) Object.assign(PM, o) }

/* ==========================================================================
   進度檔：把遊戲進度「和你錄的每一段」包成一個檔案
   一次唱完四五首不實際，所以要能存下來、換裝置、隔天再繼續。
   格式：HX1\n<JSON 標頭>\n<第一段錄音的位元組><第二段>…
   （不用 base64，檔案小三分之一，讀寫也快）
   ========================================================================== */
const PACK_MAGIC = "HX1";
async function buildPack(save) {
  const ks = (await REC.keys()).filter(k => k.indexOf("take_") === 0);
  const blobs = [], meta = [];
  for (const k of ks) {
    const b = await REC.get(k);
    if (!b || !b.size) continue;
    blobs.push(b); meta.push({ k, type: b.type || "audio/webm", len: b.size });
  }
  const head = PACK_MAGIC + "\n" + JSON.stringify({ v: 1, save, takes: meta }) + "\n";
  return { blob: new Blob([head, ...blobs], { type: "application/octet-stream" }),
           n: meta.length, bytes: meta.reduce((a, x) => a + x.len, 0) };
}
async function readPack(file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  // 前面兩個換行之間是標頭
  let n1 = -1, n2 = -1;
  for (let i = 0; i < Math.min(u8.length, 4 << 20); i++) {
    if (u8[i] === 10) { if (n1 < 0) n1 = i; else { n2 = i; break } }
  }
  if (n1 < 0 || n2 < 0) throw new Error("格式不對");
  const magic = new TextDecoder().decode(u8.subarray(0, n1));
  if (magic.trim() !== PACK_MAGIC) throw new Error("格式不對");
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(n1 + 1, n2)));
  let off = n2 + 1;
  for (const t of head.takes || []) {
    await REC.put(t.k, new Blob([u8.subarray(off, off + t.len)], { type: t.type }));
    delete takeURLs[t.k.slice(5)];
    takeExt[t.k.slice(5)] = /mp4|m4a/.test(t.type) ? "m4a" : /ogg/.test(t.type) ? "ogg" : "webm";
    off += t.len;
  }
  return head;
}
const humanMB = b => b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB";

/* ---------- 結業報告用的紀錄 ---------- */
/* 每一關發生了什麼，結算的時候一關一關講回來 */
function plog(st, ok, note) {
  PM.log = PM.log || [];
  const c = teamOf(PM.me); if (c) PM.coach = c;     // 記住當下的導師，出局後才找得回來
  if (PM.log.some(x => x.st === st)) return;
  const r = PM.res[st];
  PM.log.push({ st, ok, note, Q: r ? r.Q : null, bar: PM.free ? barOf(st) : null,
                title: PM.free ? (PM.title[st] || "自選曲") : sname(PM.song[st] || (st === "final" ? "05_會客時間" : st)) });
}
const STAGENAME = { blind: "盲選", night: "決選之夜", final: "決賽",
                    pk_04: "PK 第一夜", pk_01: "PK 第一夜", pk_03: "PK 第一夜" };
/* 四項裡面哪一項最有搶分空間：還差多少 × 佔多少權重 */
const FREEW = { pitch: 0.40, groove: 0.25, steady: 0.15, body: 0.20 };
const REFW  = { pitch: 0.50, rhythm: 0.30, complete: 0.20 };
const METNAME = { pitch: "音準", groove: "律動", steady: "穩", body: "完成度",
                  rhythm: "節奏", complete: "完整度" };
const ADVICE = {
  pitch: ["拿手機的調音 app 或鋼琴，把副歌一個音一個音對過一遍。不要用聽感，用眼睛看它準不準。",
          "先確認這首歌的 key 適不適合你。太高會逼你用喊的，一喊音就飛了。",
          "慢速跟著唱。快的時候聽不出來的偏差，放慢就無所不在。"],
  groove: ["開節拍器練。不用整首，先把副歌四小節踩準就好。",
           "一首歌裡至少要有一句是你刻意收小聲的。全程同一個力氣，聽的人會累。",
           "重音落在字上，不是落在拍上。念一次歌詞，看哪個字自然會重。"],
  steady: ["長音練習：同一個音撐八拍，音量不變、音高不動。撐不住就是氣不夠。",
           "腹式呼吸。手放肚子上，吸氣時肚子要出去，不是肩膀往上。",
           "尾音不要放掉。你每次都在最後半秒鬆手，那半秒最難聽。"],
  body: ["把整首唱完。唱一半的表演在評分上就是一半。",
         "高的低的都要碰。只在舒服的音域裡繞，聽起來就是沒事發生。",
         "確認伴奏有在跑、麥克風有收到。有大段沒出聲的話先檢查這兩件事。"],
  rhythm: ["用練歌室點歌詞跳到那一句，反覆練進歌點。",
           "把速度調到 0.75×，先跟準了再回到原速。",
           "起唱點比你想的早半拍。多數人是慢進，不是快進。"],
  complete: ["把整首唱完。中間停掉的地方會直接算成沒唱。",
             "確認伴奏有在跑、麥克風有收到。",
             "唱不動的地方用練歌室降 key，不要硬撐到後面整段崩掉。"]
};
function weakReport(res, free) {
  const W = free ? FREEW : REFW, keys = Object.keys(W);
  const avg = k => Math.round(res.reduce((a, r) => a + (r[k] || 0), 0) / res.length);
  const rows = keys.map(k => ({ k, v: avg(k), gain: (100 - avg(k)) * W[k] }))
                   .sort((a, b) => b.gain - a.gain);
  return rows;
}
function nextBarGap(res, free) {
  if (!free || !res.length) return null;
  const best = Math.max(...res.map(r => r.Q));
  const order = [["blind", FREEBAR.blind], ["pk", FREEBAR.pk], ["night", FREEBAR.night], ["final", FREEBAR.final]];
  for (const [st, b] of order) if (best < b) return { st, bar: b, gap: b - best, best };
  return { st: "final", bar: FREEBAR.final, gap: 0, best };
}

/* ---------- 結業報告的四個區塊 ---------- */
const MAPW = { rhythm: "groove", complete: "body", pitch: "pitch", groove: "groove", steady: "steady", body: "body" };
function placeCard(won, alive_, finRank, finN) {
  let head, sub;
  if (won) { head = `冠軍`; sub = `十六個人裡，最後站著的是你。`; }
  else if (alive_) { head = `決賽第 ${finRank} 名 / ${finN} 人`; sub = `十六個人一路砍到六個，你在裡面。`; }
  else {
    const o = PM.out || {}, left = PM.outAlive;
    if (o.stage === "盲選") { head = "止步盲選"; sub = "沒有導師轉身，你連隊都沒有進。"; }
    else if (o.stage === "決選之夜") { head = `決選之夜第 ${PM.nightPos || "—"} 名 / 8 人`; sub = "八個人裡淘汰兩個，你是其中一個。"; }
    else if (o.stage === "釋出") { head = `十六強中途出局`; sub = left != null ? `你走的時候場上還有 ${left} 個人——你贏過 ${Math.max(0, 15 - left)} 個。` : ""; }
    else { head = `PK 第一夜出局`; sub = left != null ? `你走的時候場上還有 ${left} 個人——你贏過 ${Math.max(0, 15 - left)} 個。` : ""; }
  }
  return `<div class="card" style="border-color:var(--amber)">
    <p class="eyebrow" style="margin:0 0 6px">最終名次</p>
    <h2 style="font-size:26px;margin:0 0 6px;color:var(--amber)">${head}</h2>
    <p class="small muted" style="margin:0">${sub}</p></div>`;
}
function journeyCard() {
  const L = PM.log || [];
  if (!L.length) return "";
  return `<div class="card"><h2 style="font-size:18px">一關一關走過來</h2>
    ${L.map(x => `<div class="rowline" style="align-items:flex-start">
      <span><b>${STAGENAME[x.st] || x.st}</b>　<span class="small muted">《${x.title}》</span><br>
        <span class="small muted">${x.note || ""}</span></span>
      <span class="mono ${x.ok ? "pos" : "neg"}" style="white-space:nowrap">${x.Q != null ? x.Q : "—"}${x.bar ? `<span class="muted small"> / ${x.bar}</span>` : ""}</span>
    </div>`).join("")}
  </div>`;
}
function adviceCard(res, free) {
  if (!res.length) return "";
  const rows = weakReport(res, free);
  const worst = rows[0], gapInfo = nextBarGap(res, free);
  const need = gapInfo && gapInfo.gap > 0
    ? Math.ceil(gapInfo.gap / (free ? FREEW[worst.k] : REFW[worst.k]))
    : 0;
  const tips = ADVICE[worst.k] || [];
  return `<div class="card"><h2 style="font-size:18px">哪裡要再加強</h2>
    <table><thead><tr><th></th><th class="num">平均</th><th class="num">最好</th><th class="num">最差</th><th class="num">還能搶</th></tr></thead>
    <tbody>${rows.map(r => {
      const vs = res.map(x => x[r.k] || 0);
      return `<tr><td>${METNAME[r.k]}</td><td class="num mono">${r.v}</td>
        <td class="num mono muted">${Math.max(...vs)}</td><td class="num mono muted">${Math.min(...vs)}</td>
        <td class="num mono ${r === rows[0] ? "neg" : "muted"}">${r.gain.toFixed(1)} 分</td></tr>`;
    }).join("")}</tbody></table>
    <p class="small muted" style="margin:12px 0 6px">「還能搶」＝這一項離滿分還差多少 × 它佔的權重。<b class="neg">${METNAME[worst.k]}</b>是你最大的空間。</p>
    ${gapInfo && gapInfo.gap > 0 ? `<p class="small" style="color:var(--amber);margin:0 0 10px">
      你最好的一次 ${gapInfo.best} 分，離${STAGENAME[gapInfo.st] || gapInfo.st}的 ${gapInfo.bar} 分還差 ${gapInfo.gap} 分——
      只要把${METNAME[worst.k]}從 ${worst.v} 拉到 ${Math.min(100, worst.v + need)} 就夠了。</p>` : ""}
    ${tips.slice(0, 2).map(t => `<p class="small" style="margin:0 0 8px">・${t}</p>`).join("")}
  </div>`;
}
function coachClosing(res, free) {
  const c = teamOf(PM.me) || PM.coach;
  if (!c || !COACHTIP[c] || !res.length) return "";
  const rows = weakReport(res, free);
  const k = MAPW[rows[0].k] || "pitch";
  const T = COACHTIP[c];
  return `<div class="card" style="border-color:var(--cyan)">
    <p class="eyebrow" style="margin:0 0 8px;color:var(--cyan)">賽後 · ${cl(c)}</p>
    <p class="small" style="margin:0 0 8px">「${pick1(T[k])}」</p>
    <p class="small muted" style="margin:0">${T.tag}</p></div>`;
}

/* ---------- 建角色 ---------- */
function playerSetup(free) {
  PM.free = !!free;
  app.innerHTML = `
  <p class="eyebrow">學員模式${free ? " · 自由模式" : ""}</p><h1>你要上台</h1>
  <p class="muted">十六個人裡面有一個是你。你會用這台手機（或電腦）的麥克風唱給四位電腦導師聽。</p>
  ${free ? `<div class="card" style="border-color:var(--amber)">
    <p class="small" style="margin:0 0 8px"><b>自由模式：每一關唱什麼都可以。</b>自己拿別的裝置放伴奏，或直接清唱。這個網站不放任何有版權的音樂，所以沒有伴奏也沒有歌詞。</p>
    <div class="rowline"><span class="small">盲選</span><span class="mono muted">${FREEBAR.blind} 分才有導師轉身</span></div>
    <div class="rowline"><span class="small">PK 第一夜</span><span class="mono muted">${FREEBAR.pk} 分</span></div>
    <div class="rowline"><span class="small">決選之夜</span><span class="mono muted">${FREEBAR.night} 分</span></div>
    <div class="rowline"><span class="small">決賽</span><span class="mono muted">${FREEBAR.final} 分才是冠軍</span></div>
    <p class="small muted" style="margin:8px 0 0">電腦聽四件事：音準、律動、穩、完成度。門檻是拿真人錄音校準出來的——唱得完整、大致在調上大約 60；普通水準 70；很不錯 80；幾乎沒有瑕疵 90。</p>
  </div>` : ""}
  <div class="card">
    <p class="small" style="margin:0 0 4px">錄音只存在這台裝置的瀏覽器裡，不會上傳、也不會傳給別人。換一台裝置就聽不到了。</p>
    <p class="small muted" style="margin:8px 0 0">${PM.free ? "自由模式沒有練歌室——你唱你自己的歌，想練多久都在你自己那邊。" : "練歌室裡可以切男聲／女聲導唱、升降 key、放慢旋律、伴奏和人聲導唱切換。"}</p>
  </div>
  <div class="card">
    <label class="small">你在台上的名字</label>
    <input id="pn" maxlength="8" placeholder="想一個藝名" style="width:100%;box-sizing:border-box;background:#12101a;border:1px solid var(--line);color:var(--paper);padding:10px;font-family:var(--sans);font-size:15px;margin:6px 0 14px">
    ${PM.free ? "" : `<label class="small">你的音域</label>
    <div id="vsel" style="margin:6px 0 14px"></div>`}
    <label class="small">你從哪裡來</label>
    <select id="ph" style="width:100%;box-sizing:border-box;background:#12101a;border:1px solid var(--line);color:var(--paper);padding:10px;font-size:15px;margin:6px 0 14px">
      ${HOMES.map(h => `<option>${h}</option>`).join("")}
    </select>
    <label class="small">上台前你會說的那一句</label>
    <input id="ps" maxlength="40" placeholder="例：我想唱給一個人聽。" style="width:100%;box-sizing:border-box;background:#12101a;border:1px solid var(--line);color:var(--paper);padding:10px;font-family:var(--sans);font-size:15px;margin:6px 0 0">
  </div>
  <p class="small muted">這一局有四位電腦導師：老派技術控、情緒派、市場派、鄉土派。沒有玩家導師——你的分數完全由電腦客觀評出來。</p>
  <p class="small" style="color:var(--amber)">這個模式<b>不保底</b>：沒有人轉身就直接淘汰，PK 輸了就出局，決選之夜排最後就走人。</p>
  <button class="btn primary" id="go">下一步</button>
  <button class="btn" id="back">回上一頁</button>`;
  document.getElementById("back").onclick = intro;
  const vs = document.getElementById("vsel");
  const paintV = () => { if (!vs) return; vs.innerHTML = "";
    ["男", "女"].forEach(g => { const b = el(`<button class="btn" style="padding:8px 16px;margin:0 8px 0 0${PM.voice===g?";border-color:var(--amber);color:var(--amber)":""}">${g}聲</button>`);
      b.onclick = () => { PM.voice = g; paintV() }; vs.appendChild(b) }) };
  paintV();
  document.getElementById("go").onclick = () => {
    PM.name = (document.getElementById("pn").value || "").trim() || "你";
    PM.home = document.getElementById("ph").value;
    PM.say = (document.getElementById("ps").value || "").trim() || "我想唱一首歌。";
    micCheck();
  };
}
async function micCheck() {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    app.innerHTML = `<p class="eyebrow">學員模式</p><h2>這個瀏覽器不能錄音</h2>
    <p class="muted">學員模式需要瀏覽器支援錄音功能，這一台不支援。</p>
    <p class="small muted">iPhone 請用 Safari、Android 請用 Chrome，而且網址要是 https 開頭。用 App 內建的瀏覽器（LINE、FB 開的那種）常常會不行，用「在瀏覽器開啟」試試看。</p>
    <button class="btn primary" id="coach">改玩導師模式</button>
    <button class="btn" id="back">回開場</button>`;
    document.getElementById("coach").onclick = intro;
    document.getElementById("back").onclick = intro;
    return;
  }
  app.innerHTML = `<p class="eyebrow">學員模式 · 麥克風</p><h2>先讓瀏覽器問你要不要開麥克風</h2>
  <p class="muted">按下去之後，瀏覽器會跳出詢問。要按「允許」才能錄。</p>
  <button class="btn primary" id="ask">開麥克風</button>
  <button class="btn" id="back">回上一頁</button>`;
  document.getElementById("back").onclick = playerSetup;
  document.getElementById("ask").onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      st.getTracks().forEach(t => t.stop());
      if (PM.free) { PM.song.blind = null; return startPlayerGame() }
      pickBlindSong();
    } catch (e) {
      app.innerHTML = `<p class="eyebrow">學員模式</p><h2>沒有拿到麥克風</h2>
      <p class="muted">瀏覽器擋住了，或是你按了「不允許」。學員模式一定要麥克風。</p>
      <p class="small muted">iPhone 請用 Safari，Android 請用 Chrome，網址要是 https 開頭。</p>
      <button class="btn primary" id="again">再試一次</button>
      <button class="btn" id="coach">改玩導師模式</button>`;
      document.getElementById("again").onclick = micCheck;
      document.getElementById("coach").onclick = intro;
    }
  };
}
/* 盲選：八選一。先讓你聽過再決定。 */
function pickBlindSong() {
  let g = PM.voice, playing = null;
  app.innerHTML = `<p class="eyebrow">學員模式 · 盲選自選曲</p><h2>你要唱哪一首</h2>
  <p class="muted">八首裡面挑一首。<b>只有盲選這一關可以自己選</b>，後面幾關都是被指定的。</p>
  <p class="small muted">先聽過再決定。按「試聽」會放原曲，歌詞會跟著跑。挑完進練歌室，想練多久就練多久。</p>
  <div class="card"><div class="rowline"><span class="small">試聽聲線</span><span id="gb"></span></div></div>
  <audio id="pv" preload="none"></audio>
  ${lyricBox()}
  <div class="bar"><i id="pvp"></i></div>
  <div id="s"></div>`;
  const pv = document.getElementById("pv");
  pv.ontimeupdate = () => { const e=document.getElementById("pvp"); if(e) e.style.width=(pv.currentTime/(pv.duration||1)*100)+"%" };
  pv.onended = () => { playing = null; paint() };

  const stop = () => { pv.pause(); pv.removeAttribute("src"); playing = null;
    const lb = app.querySelector(".lyric"); if (lb) { lb.querySelector(".now").textContent="♪"; lb.querySelector(".next").textContent="" } };

  function play(k) {
    if (playing === k) { stop(); paint(); return }
    const h = mhash(k, g);
    pv.src = MIXURL(h);
    attachLyrics(pv, h, app.querySelector(".lyric"));
    pv.currentTime = 0; pv.play();
    playing = k; paint();
  }
  function paint() {
    const gb = document.getElementById("gb"); gb.innerHTML = "";
    ["男","女"].forEach(x => {
      const b = el(`<button class="btn" style="padding:6px 12px;margin:0 0 0 6px;font-size:13px${g===x?";border-color:var(--amber);color:var(--amber)":""}">${x}聲</button>`);
      b.onclick = () => { g = x; PM.voice = x; const was = playing; stop(); if (was) play(was); else paint() };
      gb.appendChild(b);
    });
    const box = document.getElementById("s"); box.innerHTML = "";
    BLIND_POOL.forEach(k => {
      const on = playing === k;
      const card = el(`<div class="card" style="padding:14px 18px${on?";border-color:var(--amber)":""}">
        <div class="rowline" style="align-items:flex-start">
          <span><b>《${sname(k)}》</b><br><span class="small muted">${SONGHINT[k]||""}</span></span>
          <span style="white-space:nowrap"></span>
        </div></div>`);
      const right = card.querySelectorAll("span")[card.querySelectorAll("span").length-1];
      const pb = el(`<button class="btn" style="padding:6px 12px;margin:0 0 0 6px;font-size:13px${on?";border-color:var(--amber);color:var(--amber)":""}">${on?"停":"試聽"}</button>`);
      pb.onclick = () => play(k);
      const cb = el(`<button class="btn primary" style="padding:6px 12px;margin:0 0 0 6px;font-size:13px">就唱這首</button>`);
      cb.onclick = () => { stop(); PM.song.blind = k; startPlayerGame() };
      right.appendChild(pb); right.appendChild(cb);
      box.appendChild(card);
    });
  }
  paint();
}

/* ---------- 伴奏播放器：可以變 key、可以放慢 ---------- */
/* key 用 AudioWorklet 做顆粒式移調（速度不變）；放慢用 <audio> 自己的
   playbackRate + preservesPitch（音高不變）。兩個互不干擾。 */
const PSCODE = `
class PS extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:'ratio',defaultValue:1,minValue:0.4,maxValue:2.6,automationRate:'k-rate'}]}
  constructor(){ super(); this.N=1<<15; this.G=3072;
    this.buf=[new Float32Array(this.N),new Float32Array(this.N)]; this.w=0; this.ph=0; }
  process(inputs, outputs, params){
    const inp=inputs[0], out=outputs[0];
    if(!out||!out.length) return true;
    if(!inp||!inp.length||!inp[0]){ for(const c of out) c.fill(0); return true }
    const r=params.ratio[0], n=out[0].length, N=this.N, G=this.G, M=N-1;
    const inCh=inp.length, outCh=out.length, nc=Math.min(inCh,2);
    for(let i=0;i<n;i++){
      for(let c=0;c<nc;c++) this.buf[c][this.w]=inp[c][i];
      const p=this.ph; let q=p+0.5; if(q>=1) q-=1;
      const gA=1-Math.abs(2*p-1), gB=1-Math.abs(2*q-1);
      const dA=p*G, dB=q*G;
      for(let c=0;c<nc;c++){
        const b=this.buf[c];
        let x=this.w-dA, i0=Math.floor(x), f=x-i0;
        const va=b[i0&M]*(1-f)+b[(i0+1)&M]*f;
        x=this.w-dB; i0=Math.floor(x); f=x-i0;
        const vb=b[i0&M]*(1-f)+b[(i0+1)&M]*f;
        const y=va*gA+vb*gB;
        out[c][i]=y;
        if(nc===1) for(let d=1;d<outCh;d++) out[d][i]=y;
      }
      this.ph+=(1-r)/G; if(this.ph>=1)this.ph-=1; else if(this.ph<0)this.ph+=1;
      this.w=(this.w+1)&M;
    }
    return true;
  }
}
registerProcessor('ps', PS);
`;
let _psURL=null, _ctx=null, _wlReady=null;
function psURL(){ if(!_psURL) _psURL=URL.createObjectURL(new Blob([PSCODE],{type:"text/javascript"})); return _psURL }
function audioCtx(){ if(!_ctx) _ctx=new (window.AudioContext||window.webkitAudioContext)(); return _ctx }
async function ensureWorklet(){
  if(_wlReady) return _wlReady;
  _wlReady=(async()=>{ try{ await audioCtx().audioWorklet.addModule(psURL()); return true }catch(e){ return false } })();
  return _wlReady;
}
/* 一個 <audio> 綁一條處理鏈。同一個 element 只能接一次 MediaElementSource，所以存起來重用。 */
const _chain=new WeakMap();
async function attachChain(au){
  if(_chain.has(au)) return _chain.get(au);
  const ok=await ensureWorklet();
  if(!ok){ const c={ok:false,setKey(){}}; _chain.set(au,c); return c }
  const ctx=audioCtx();
  let src,node;
  try{
    src=ctx.createMediaElementSource(au);
    node=new AudioWorkletNode(ctx,'ps',{outputChannelCount:[2]});
    src.connect(node); node.connect(ctx.destination);
  }catch(e){ const c={ok:false,setKey(){}}; _chain.set(au,c); return c }
  const c={ok:true,node,setKey(k){ try{ node.parameters.get('ratio').value=Math.pow(2,k/12) }catch(e){} }};
  _chain.set(au,c); return c;
}
function setSpeed(au,sp){
  au.playbackRate=sp;
  try{ au.preservesPitch=true; au.mozPreservesPitch=true; au.webkitPreservesPitch=true; }catch(e){}
}

/* ---------- 錄音時的即時音量表 ---------- */
/* 沒有這個東西，你要在「不知道麥克風有沒有收到聲音」的狀態下一次定生死 */
function startMeter(stream, box) {
  let raf = null, ac = null, peak = 0, clip = 0, frames = 0, loud = 0;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
    an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const bar = box && box.querySelector("i");
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let m = 0; for (const v of buf) { const a = Math.abs(v); if (a > m) m = a }
      frames++; if (m > peak) peak = m; if (m > 0.985) clip++; if (m > 0.04) loud++;
      if (bar) { bar.style.width = Math.min(100, m * 140) + "%"; bar.className = m > 0.95 ? "hot" : "" }
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {}
  return {
    stop() { if (raf) cancelAnimationFrame(raf); if (ac) try { ac.close() } catch (e) {}
      return { peak, clipRate: frames ? clip / frames : 0, loudRate: frames ? loud / frames : 0 } }
  };
}
/* 錄完之後，如果音量明顯有問題就直說 */
function levelWarn(lv) {
  if (!lv) return "";
  if (lv.peak < 0.02) return "<b>幾乎沒有收到聲音。</b>檢查麥克風權限、有沒有選到對的裝置，或是離麥克風近一點。";
  if (lv.loudRate < 0.08) return "收到的聲音很少——大部分時間是安靜的。是不是離麥克風太遠、或中間停很久？";
  if (lv.clipRate > 0.02) return "<b>音量爆掉了。</b>離麥克風遠一點，或把輸入音量調小。破音會讓音準判讀失準。";
  if (lv.peak < 0.10) return "音量偏小。離麥克風近一點分數會更準。";
  return "";
}

/* ---------- 卡拉 OK：大字當前句 + 下面一整份歌詞，點哪一句就跳到哪 ---------- */
const _kara = new WeakMap();
function attachKaraoke(au, hash, box, fullBox) {
  const prev = _kara.get(au);
  if (prev) { au.removeEventListener("timeupdate", prev); _kara.delete(au) }
  const L = (typeof LYRICS !== "undefined") && LYRICS[hash];
  const now = box && box.querySelector(".now"), nx = box && box.querySelector(".next");
  if (fullBox) fullBox.innerHTML = "";
  if (!L || !L.length) {
    if (box) box.style.display = "none";
    if (fullBox) fullBox.style.display = "none";
    return;
  }
  if (box) box.style.display = "";
  if (fullBox) {
    fullBox.style.display = "";
    L.forEach(ln => {
      const p = document.createElement("p");
      p.textContent = ln[2];
      p.title = "跳到這一句";
      p.onclick = () => { au.currentTime = Math.max(0, ln[0] - 0.8); if (au.paused) au.play() };
      fullBox.appendChild(p);
    });
  }
  let lastIx = -1;
  const h = () => {
    const t = au.currentTime; let cur = null, curIx = -1, next = null;
    for (let i = 0; i < L.length; i++) {
      const ln = L[i];
      if (t >= ln[0] - 0.15 && t <= ln[1] + 0.35) { cur = ln; curIx = i }
      else if (ln[0] > t) { next = ln; break }
    }
    if (now) { now.textContent = cur ? cur[2] : "♪"; now.style.opacity = cur ? 1 : 0.35 }
    if (nx) nx.textContent = next ? next[2] : "";
    if (fullBox && curIx !== lastIx) {
      const ps = fullBox.children;
      if (lastIx >= 0 && ps[lastIx]) ps[lastIx].classList.remove("on");
      if (curIx >= 0 && ps[curIx]) {
        ps[curIx].classList.add("on");
        const e = ps[curIx];
        fullBox.scrollTo({ top: Math.max(0, e.offsetTop - fullBox.clientHeight / 2 + e.offsetHeight / 2), behavior: "smooth" });
      }
      lastIx = curIx;
    }
  };
  au.addEventListener("timeupdate", h); _kara.set(au, h); h();
}
const mmss = t => (isFinite(t) ? Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") : "0:00");
/* 這個分數大概贏得過幾成的 AI 選手（來自四萬次模擬的對照表） */
const BEATTAB = [[12, 0], [31, 1], [44, 16], [56, 61], [69, 97], [82, 100], [94, 100]];
function beatPct(Q) {
  if (Q <= BEATTAB[0][0]) return 0;
  for (let i = 1; i < BEATTAB.length; i++) {
    const [q1, p1] = BEATTAB[i], [q0, p0] = BEATTAB[i - 1];
    if (Q <= q1) return Math.round(p0 + (p1 - p0) * (Q - q0) / (q1 - q0));
  }
  return 100;
}
function passHint(Q) {
  const b = beatPct(Q), C = FREEBAR.final;
  const champ = Q >= C ? `到了冠軍門檻 ${C}——決賽唱出這個分數就是冠軍。`
                       : `冠軍門檻 ${C}，還差 ${C - Q} 分。`;
  if (Q >= 75) return `贏過大約 ${b}% 的 AI 選手。前面幾關很穩。${champ}`;
  if (Q >= 62) return `贏過大約 ${b}% 的 AI 選手。盲選會過，PK 就看抽到誰。${champ}`;
  if (Q >= 50) return `贏過大約 ${b}% 的 AI 選手。盲選大概會過，後面關卡會很危險。${champ}`;
  if (Q >= 38) return `贏過大約 ${b}% 的 AI 選手。盲選可能勉強過，之後很難撐住。${champ}`;
  return `贏過大約 ${b}% 的 AI 選手。這樣上台會被淘汰，再多練幾次。`;
}

/* 一次唱完四五首不實際，每個要開口的地方都留一個出口 */
function pauseBtn() {
  return `<button class="btn" id="pausebtn" style="margin-top:10px">先存起來，之後再繼續</button>`;
}
function bindPause() {
  const b = document.getElementById("pausebtn");
  if (!b) return;
  b.onclick = () => { try { saveGame(LASTPHASE) } catch (e) {} intro() };
}

/* ---------- 練歌室 ---------- */
/* opt = {stage, songKey, eyebrow, note, onGo, free} */
function practiceRoom(opt) {
  const k = opt.songKey, FREE = !!opt.free;
  const st = { g: hasVoice(k, PM.voice) ? PM.voice : (hasVoice(k,"男") ? "男" : "女"),
               key: 0, speed: 1, guide: "bk" };
  let mr = null, chunks = [], stream = null, official = false, chain = null;
  let meter = null, lastLevel = null, recStart = 0, aborted = false;

  const hash = () => mhash(k, st.g);
  const srcURL = () => st.guide === "bk" ? BKURL(hash()) : MIXURL(hash());

  app.innerHTML = `<p class="eyebrow">${opt.eyebrow}</p><h2>練歌室</h2>
  <p class="muted">《${sname(k)}》${opt.note ? "　" + opt.note : ""}</p>
  ${FREE ? "" : briefFor(opt.stage)}
  <audio id="bk" preload="auto"></audio>
  <div class="seekbar" id="seek"><div class="bar"><i id="prog"></i></div></div>
  <div class="rowline" style="border:0;padding:2px 0 8px">
    <span class="mono small muted" id="tt">0:00 / 0:00</span>
    <span id="jump"></span>
  </div>
  ${lyricBox()}
  <div class="lyrall" id="full"></div>
  <p class="small muted" style="margin:0 0 14px">點歌詞任何一句就會跳到那裡——想單練副歌或第二段主歌，直接點下去。上面那條也可以拖著找位置。</p>
  <div class="card" id="ctl">
    <div class="ctlrow"><span class="lab">導唱聲線</span><span class="chips" id="gbtns"></span></div>
    <div class="ctlrow"><span class="lab">聽什麼</span><span class="chips" id="vbtns"></span></div>
    <div class="ctlrow"><span class="lab">Key　<b class="mono" id="kv">原 key</b></span><span class="chips" id="kbtns"></span></div>
    <div class="ctlrow"><span class="lab">速度　<b class="mono" id="sv">1×</b></span><span class="chips" id="sbtns"></span></div>
    <p class="small muted" id="cnote" style="margin:10px 0 0"></p>
  </div>
  <div class="card">
    <button class="btn" id="only">播放（自己跟著唱）</button>
    <button class="btn" id="rec">開始錄${FREE ? "" : "（試唱，可以重來）"}</button>
    <button class="btn" id="stop" disabled>停</button>
    <div class="meter" id="mtr"><i></i></div>
    <p class="small muted" id="mnote" style="margin:0">錄音時這條會跟著你的聲音跳。都不動就是麥克風沒收到。</p>
  </div>
  <div id="sc"></div>
  ${FREE ? `<div class="card">
    <p class="small muted" style="margin:0 0 10px">這裡怎麼錄都不算數，錄完會告訴你這個分數大概能不能過關。</p>
    <button class="btn" id="go">回練歌大廳</button>
  </div>`
  : `<div class="card">
    <p class="small muted" style="margin:0 0 10px">覺得可以了再上台。<b>正式比賽只錄一次，不能重來。</b>
    正式那一次會自動切回<b>只有伴奏、原速</b>，Key 會照你現在選的。</p>
    <button class="btn primary" id="go">開始比賽</button>
  </div>`}
  <p class="small muted">耳機建議戴上，不然伴奏會被錄進去，音準會被拉掉。</p>
  ${FREE ? "" : pauseBtn()}`;

  const bk = document.getElementById("bk");
  const full = document.getElementById("full");
  bk.ontimeupdate = () => {
    const e = document.getElementById("prog"); if (e) e.style.width = (bk.currentTime/(bk.duration||1)*100)+"%";
    const t = document.getElementById("tt"); if (t) t.textContent = mmss(bk.currentTime)+" / "+mmss(bk.duration);
  };
  document.getElementById("seek").onclick = e => {
    if (!isFinite(bk.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    bk.currentTime = Math.max(0, Math.min(bk.duration - 0.2, (e.clientX - r.left) / r.width * bk.duration));
  };
  {
    const jb = document.getElementById("jump");
    [["⏮ 從頭", () => bk.currentTime = 0],
     ["−10 秒", () => bk.currentTime = Math.max(0, bk.currentTime - 10)],
     ["＋10 秒", () => bk.currentTime = Math.min((bk.duration||0) - 0.2, bk.currentTime + 10)]]
    .forEach(([t, fn]) => {
      const b = el(`<button class="btn" style="padding:5px 10px;margin:0 0 0 6px;font-size:12px">${t}</button>`);
      b.onclick = fn; jb.appendChild(b);
    });
  }

  const chip = (box, label, on, dis, fn) => {
    const b = el(`<button class="btn" style="padding:7px 14px;font-size:13px${on?";border-color:var(--amber);color:var(--amber)":""}"${dis?" disabled":""}>${label}</button>`);
    if (!dis) b.onclick = fn;
    box.appendChild(b); return b;
  };
  function reload(keepTime) {
    const t = keepTime ? bk.currentTime : 0, playing = !bk.paused;
    bk.src = srcURL(); bk.currentTime = t;
    attachKaraoke(bk, hash(), app.querySelector(".lyric"), full);
    if (playing) bk.play();
  }
  function paint() {
    const gb=document.getElementById("gbtns"); gb.innerHTML="";
    ["男","女"].forEach(g=>chip(gb, g+"聲", st.g===g, !hasVoice(k,g), ()=>{st.g=g;PM.voice=g;reload(false);paint()}));
    const vb=document.getElementById("vbtns"); vb.innerHTML="";
    chip(vb,"只有伴奏",st.guide==="bk",false,()=>{st.guide="bk";reload(true);paint()});
    chip(vb,"人聲導唱",st.guide==="mix",false,()=>{st.guide="mix";reload(true);paint()});
    const kb=document.getElementById("kbtns"); kb.innerHTML="";
    chip(kb,"−1",false,st.key<=-6,()=>{st.key--;applyKey();paint()});
    chip(kb,"歸零",st.key===0,false,()=>{st.key=0;applyKey();paint()});
    chip(kb,"＋1",false,st.key>=6,()=>{st.key++;applyKey();paint()});
    const sb=document.getElementById("sbtns"); sb.innerHTML="";
    [0.6,0.75,0.9,1].forEach(v=>chip(sb,v+"×",st.speed===v,false,()=>{st.speed=v;setSpeed(bk,v);paint()}));
    document.getElementById("kv").textContent=KEYNAME(st.key);
    document.getElementById("sv").textContent=st.speed+"×";
    const n=[];
    if(chain&&!chain.ok&&st.key!==0) n.push("這個瀏覽器不支援即時移調，Key 會沒有作用。");
    if(st.speed!==1) n.push(FREE?"放慢時分數只能當參考。":"放慢只是練習用，正式比賽一律原速。");
    document.getElementById("cnote").textContent=n.join(" ");
  }
  async function applyKey(){ if(!chain) chain=await attachChain(bk); chain.setKey(st.key) }

  reload(false); paint(); bindPause();

  const setBusy = b => ["only","rec","go"].forEach(x=>{const e=document.getElementById(x); if(e) e.disabled=b});
  document.getElementById("only").onclick = async e => {
    if (!bk.paused) { bk.pause(); e.target.textContent = "播放（自己跟著唱）"; return }
    if (!chain) chain = await attachChain(bk);
    try { await audioCtx().resume() } catch (x) {}
    chain.setKey(st.key); setSpeed(bk, st.speed);
    bk.play(); e.target.textContent = "暫停"; paint();
  };
  const startRec = async (isOfficial) => {
    official = isOfficial;
    if (isOfficial) { st.guide = "bk"; st.speed = 1; reload(false); paint() }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
    catch (e) { alert("拿不到麥克風。"); return }
    if (!chain) chain = await attachChain(bk);
    try { await audioCtx().resume() } catch (x) {}
    chain.setKey(st.key); setSpeed(bk, st.speed);
    chunks = []; mr = new MediaRecorder(stream);
    meter = startMeter(stream, document.getElementById("mtr"));
    document.getElementById("mtr").classList.add("on");
    recStart = Date.now(); aborted = false;
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      lastLevel = meter ? meter.stop() : null; meter = null;
      const m = document.getElementById("mtr"); if (m) { m.classList.remove("on"); m.querySelector("i").style.width = 0 }
      if (aborted) { const g2 = id => document.getElementById(id);
        bk.pause(); setBusy(false);
        if (g2("stop")) g2("stop").disabled = true;
        if (g2("pausebtn")) g2("pausebtn").disabled = false;
        if (g2("rec")) g2("rec").textContent = "開始錄";
        if (g2("go")) g2("go").textContent = "開始比賽";
        if (g2("sc")) g2("sc").innerHTML = `<div class="card"><p class="small muted" style="margin:0">這次不算，重來就好。</p></div>`;
        return }
      await finishTake(new Blob(chunks, { type: chunks[0] ? chunks[0].type : "audio/webm" }));
    };
    const g = id => document.getElementById(id);
    if (g("sc")) g("sc").innerHTML = "";
    setBusy(true); if (g("stop")) g("stop").disabled = false;
    if (g("pausebtn")) g("pausebtn").disabled = true;    // 錄音中不能中途離開
    if (g("rec")) g("rec").textContent = isOfficial ? "正式錄音中…" : "錄音中…";
    if (g("only")) g("only").textContent = "播放（自己跟著唱）";
    bk.currentTime = 0; bk.play(); mr.start();
    if (isOfficial) {
      const ab = el(`<button class="btn danger" id="abort" style="margin-top:8px">開頭出狀況，這次不算</button>`);
      document.getElementById("sc").innerHTML = "";
      document.getElementById("sc").appendChild(ab);
      ab.onclick = () => { aborted = true; if (mr && mr.state === "recording") mr.stop() };
      setTimeout(() => { const e = document.getElementById("abort"); if (e) e.remove() }, 20000);
    }
    bk.onended = () => { if (mr && mr.state === "recording") mr.stop() };
  };
  const finishTake = async (blob) => {
    const $ = id => document.getElementById(id);
    bk.pause();
    if ($("stop")) $("stop").disabled = true;
    if ($("sc")) $("sc").innerHTML =
      `<div class="card"><p class="small" style="margin:0">電腦在聽…<b id="pp" class="mono">0%</b></p></div>`;
    const useKey = st.speed === 1 ? st.key : 0;
    const r = await analyzeTake(blob, hash(), useKey,
      p => { const e = $("pp"); if (e) e.textContent = Math.round(p * 100) + "%" });
    r.slow = st.speed !== 1;
    PM.last = r;
    if (official) {
      await REC.put("take_" + opt.stage, blob);
      delete takeURLs[opt.stage];
      takeExt[opt.stage] = /mp4|m4a/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
      PM.res[opt.stage] = r; PM.song[opt.stage] = k;
      PM.mhash[opt.stage] = hash(); PM.key[opt.stage] = st.key; PM.voice = st.g;
      saveGame(LASTPHASE);                       // 唱完就存，走人也不會白唱
      const url2 = URL.createObjectURL(blob);
      app.innerHTML = `<p class="eyebrow">${opt.eyebrow}</p><h2>唱完了</h2>
      <p class="muted">《${sname(k)}》・${st.g}聲・${KEYNAME(st.key)}</p>
      ${scoreCard(r)}
      ${levelWarn(lastLevel)?`<div class="card"><p class="small" style="margin:0;color:var(--amber)">${levelWarn(lastLevel)}</p></div>`:""}
      <div class="card"><p class="small muted" style="margin:0 0 8px">${qNote(r)}<br>${passHint(r.Q)}</p>
        <audio controls src="${url2}"></audio>
        <p class="small muted" style="margin:6px 0 0">這段只有你聽得到。</p></div>
      <button class="btn primary" id="n">上台</button>
      ${pauseBtn()}`;
      document.getElementById("n").onclick = () => opt.onGo(r);
      bindPause();
      return;
    }
    setBusy(false);
    if ($("rec")) $("rec").textContent = "再錄一次";
    if ($("pausebtn")) $("pausebtn").disabled = false;
    const url = URL.createObjectURL(blob);
    if (!$("sc")) return;
    $("sc").innerHTML = `
    <div class="card"><h2 style="font-size:18px">電腦怎麼聽你這一次</h2>
      <p class="small muted" style="margin:0 0 10px">${st.g}聲導唱・${KEYNAME(st.key)}・${st.speed}×${st.guide==="mix"?"・原曲帶唱":""}</p>
      ${r.slow?`<p class="small" style="color:var(--amber);margin:0 0 10px">你剛剛是放慢唱的，分數只能當參考。要看真的分數請切回 1×。</p>`:""}
      <div class="rowline"><span>音準</span><span class="mono ${r.pitch>=60?"pos":"neg"}">${r.pitch}</span></div>
      <div class="rowline"><span>節奏</span><span class="mono ${r.rhythm>=60?"pos":"neg"}">${r.rhythm}</span></div>
      <div class="rowline"><span>完整度</span><span class="mono ${r.complete>=60?"pos":"neg"}">${r.complete}</span></div>
      <div class="rowline"><span><b>綜合</b></span><span class="mono"><b>${r.Q}</b></span></div>
      <p class="small muted" style="margin:10px 0 0">${qNote(r)}</p>
      ${levelWarn(lastLevel)?`<p class="small" style="margin:8px 0 0;color:var(--amber)">${levelWarn(lastLevel)}</p>`:""}
      ${r.slow?"":`<p class="small" style="margin:8px 0 0;color:var(--cyan)">${passHint(r.Q)}</p>`}
      <audio controls src="${url}" style="margin-top:10px"></audio>
      <p class="small muted" style="margin:6px 0 0">這段只有你聽得到。</p>
    </div>`;
  };
  document.getElementById("rec").onclick = () => startRec(false);
  document.getElementById("stop").onclick = () => { if (mr && mr.state === "recording") mr.stop() };
  document.getElementById("go").onclick = () => {
    if (FREE) { bk.pause(); return freePractice() }
    if (!confirm(`正式上台唱《${sname(k)}》（${st.g}聲・${KEYNAME(st.key)}）。只錄一次，唱完就送出，不能重來。要開始嗎？`)) return;
    document.getElementById("go").textContent = "正式錄音中…";
    startRec(true);
  };
}

/* ==========================================================================
   上台前，你的導師會跟你講一句話。
   四位導師在意的東西不一樣，講的內容也會看你上一次的分數最弱在哪。

   >>> 這一整塊是純文字，之後如果有真的聲樂老師願意合作，
       直接把下面的句子換成他的說法就好，程式不用動。 <<<
   每位導師：
     tag    一句話介紹他的立場
     first  你還沒有分數時（第一次上台前）講的
     pitch  你音準最弱時講的
     groove 你律動最弱時講的
     steady 你長音撐不住時講的
     body   你唱太短、音域太窄時講的
     stage  各關卡專屬的一句
   ========================================================================== */
const COACHTIP = {
  "老派技術控": {
    tag: "他只在乎準不準。他覺得感情是唱準之後才有的東西。",
    first: ["先不要想感情。你把每個音唱在該在的位置上，感情自己會出來。",
            "熱身。從最低音慢慢爬上去再爬下來，爬三趟再開口唱歌。"],
    pitch: ["你的音一直在旁邊繞，沒有踩進去。慢速把旋律哼一遍，一個音一個音確認。",
            "換氣不夠的時候音就會塌下去。你先解決氣，音準會跟著回來。"],
    groove: ["你唱得很準，但整首平平的。準是及格，不是滿分。",
             "拍子你自己數。心裡有數，聲音才不會飄。"],
    steady: ["長音是照妖鏡。撐不住就不要寫長音進去——但你既然唱了，就撐完。",
             "尾音不要放掉。你每次都在最後半秒鬆手，那半秒最難聽。"],
    body: ["唱完整首。半首的表演在我這裡不算表演。",
           "只用五個音的歌不叫歌。把音域打開。"],
    stage: { blind: "第一次上台不要飆。穩穩唱完，我聽得出你有沒有底子。",
             pk: "對手唱什麼不重要。你唱錯一個音才重要。",
             night: "台下不知道你是誰。這一關只剩聲音，沒有故事可以擋。",
             final: "最後一次了。不要為了拚高音把整首毀掉。" }
  },
  "情緒派": {
    tag: "他要聽到掙扎。唱得太順他反而覺得沒東西。",
    first: ["你為什麼要唱這首？想清楚再開口，不然只是在發出聲音。",
            "第一句最重要。你用什麼表情進來，整首就是什麼顏色。"],
    pitch: ["音不準我可以忍。但你不準是因為你在猜，不是因為你在給。",
            "你太小心了。放開一點反而會準。"],
    groove: ["該用力的地方要用力，該收的地方要真的收。你現在整首同一個力氣。",
             "歌是有起伏的。你把最重的那句留到最後，前面先讓路。"],
    steady: ["長音不是撐著就好，那是你把情緒攤開來給人看的地方。",
             "你的聲音在抖，但抖得沒有理由。抖要有原因。"],
    body: ["唱長一點。感情堆不起來就沒有東西。",
           "低的地方也要唱。只在舒服的音域裡唱，聽起來就是沒事發生。"],
    stage: { blind: "他們背對著你。你只有聲音——那就把話說進去。",
             pk: "你不是在跟他比。你是在講一件他講不出來的事。",
             night: "沒有名字反而好。今天他們只會記得有沒有被打到。",
             final: "最後一首，唱給那個讓你來的人聽。" }
  },
  "市場派": {
    tag: "他想的是這首歌明天有沒有人記得。",
    first: ["挑一首有記憶點的。副歌前八個字要能讓人跟著哼。",
            "開頭三秒決定一切。不要慢慢暖，一開口就要抓住人。"],
    pitch: ["準不準聽眾其實聽得出來，只是他們說不出原因。別冒險。",
            "你不準的地方剛好都在副歌。那是最多人會記得的地方。"],
    groove: ["歌要有律動才會被記住。平平地唸完不會有人轉頭。",
             "你可以在同一句裡面做強弱，那就是專業跟業餘的差別。"],
    steady: ["長音是你要人家記得的那一刻。那一刻不能晃。",
             "音量忽大忽小，聽的人會累。累就會轉台。"],
    body: ["唱滿。一分半以下的表演做不成一首歌。",
           "音域再拉開一點，聽起來才有層次。"],
    stage: { blind: "這是你唯一一次自我介紹的機會。想清楚要留下什麼印象。",
             pk: "贏的不一定是唱得好的，是被記住的那個。",
             night: "匿名。所以要靠聲音本身有辨識度。",
             final: "今天之後有人會去找你的名字。給他一個理由。" }
  },
  "鄉土派": {
    tag: "他聽你從哪裡來。他要聽到人味，不要聽到訓練。",
    first: ["用你平常講話的位置唱。不要裝。",
            "找一首你在家會唱的。裝出來的東西聽得出來。"],
    pitch: ["準是好事，但別為了準把自己唱僵了。",
            "你在追音，不是在唱歌。慢下來，讓音自己來找你。"],
    groove: ["你走路有節奏，唱歌也應該有。跟著自己的呼吸走。",
             "台語歌也好國語歌也好，該咬重的字咬重，人家才聽得懂你在說什麼。"],
    steady: ["長音就是一口氣。氣穩，人就穩。",
             "不要一直加抖音。你不抖的時候反而好聽。"],
    body: ["唱久一點。前面那幾句只是你在暖身而已。",
           "高的低的都用一點。整首同一個高度會聽膩。"],
    stage: { blind: "他們看不到你。這反而好——他們只會聽到你是什麼樣的人。",
             pk: "不要學對手。你贏他的地方不在他的場子上。",
             night: "沒有名字沒關係，你的口音會替你講話。",
             final: "唱給家裡那邊的人聽。就這樣。" }
  }
};
/* 上一次表現最弱的是哪一項 */
function weakestOf(r) {
  if (!r) return null;
  const m = [["pitch", r.pitch !== undefined ? r.pitch : 100],
             ["groove", r.groove !== undefined ? r.groove : (r.rhythm !== undefined ? r.rhythm : 100)],
             ["steady", r.steady !== undefined ? r.steady : 100],
             ["body", r.body !== undefined ? r.body : (r.complete !== undefined ? r.complete : 100)]];
  m.sort((a, b) => a[1] - b[1]);
  return m[0][0];
}
const pick1 = a => a && a.length ? a[Math.floor(Math.random() * a.length)] : "";
/* 上台前導師講的話。coach 是你的導師，沒有導師（盲選）就回傳空字串。 */
function coachBrief(coach, stage, last) {
  const T = COACHTIP[coach];
  if (!T) return "";
  const w = weakestOf(last);
  const lines = [];
  const sl = T.stage[stage === "night" ? "night" : stage === "final" ? "final"
            : stage === "blind" ? "blind" : "pk"];
  if (sl) lines.push(sl);
  lines.push(w ? pick1(T[w]) : pick1(T.first));
  return `<div class="card" style="border-color:var(--cyan)">
    <p class="eyebrow" style="margin:0 0 8px;color:var(--cyan)">上台前 · ${cl(coach)}</p>
    ${lines.map(x => `<p class="small" style="margin:0 0 8px">「${x}」</p>`).join("")}
    <p class="small muted" style="margin:6px 0 0">${T.tag}</p>
  </div>`;
}
/* 盲選還沒有導師，給一段中性的提醒 */
const STAFFTIP = [
  "工作人員：麥克風離嘴巴一個拳頭，太近會爆、太遠會空。",
  "工作人員：戴耳機。伴奏被錄進去，音準會被拉掉。",
  "工作人員：先清一次喉嚨、喝口水，再按開始。",
  "工作人員：唱滿一分鐘以上，完成度那一項才會給滿。"
];
function briefFor(stage) {
  if (!PM.on) return "";
  const c = (typeof teamOf === "function") ? teamOf(PM.me) : null;
  if (c && COACHTIP[c]) return coachBrief(c, stage, PM.last || PM.res[stage]);
  return `<div class="card"><p class="small muted" style="margin:0">${pick1(STAFFTIP)}</p></div>`;
}

/* ---------- 自由模式：正式錄音室（接進比賽的那一個） ---------- */
/* opt = {stage, eyebrow, note, onGo} */
function freeRoom(opt) {
  const st = opt.stage, bar = barOf(st);
  let mr = null, chunks = [], stream = null, t0 = 0, tick = null, official = false;
  let meter = null, lastLevel = null, aborted = false, takeTitle = "";
  app.innerHTML = `<p class="eyebrow">${opt.eyebrow}</p><h2>換你上台</h2>
  <p class="muted">${opt.note || ""}</p>
  ${briefFor(st)}
  <div class="card" style="border-color:var(--amber)">
    <div class="rowline" style="border:0"><span><b>這一關的門檻</b></span><span class="mono" style="font-size:22px;color:var(--amber)">${bar}</span></div>
    <p class="small muted" style="margin:8px 0 0">${st === "blind"
      ? `${FREEBAR.blind} 分才會有導師轉身。分數越高轉的越多：${FREEBAR.blind}–69 一位、70–79 兩位、80–89 三位、90 以上四位全轉，你自己挑。`
      : `到 ${bar} 分就過關，沒到就出局。`}</p>
  </div>
  <div class="card">
    <label class="small">你要唱什麼（自己放伴奏或清唱都可以）</label>
    <input id="tt" maxlength="24" placeholder="打上歌名，之後結算會用到" style="width:100%;box-sizing:border-box;background:#12101a;border:1px solid var(--line);color:var(--paper);padding:10px;font-family:var(--sans);font-size:15px;margin:6px 0 0">
  </div>
  <div class="card">
    <p class="mono" id="clk" style="font-size:34px;margin:0 0 2px;color:var(--amber)">0:00</p>
    <p class="small muted" style="margin:0 0 10px">唱滿 1:00 完成度才會滿分・不到 0:30 總分會被打折</p>
    <div class="meter" id="mtr"><i></i></div>
    <p class="small muted" id="mnote" style="margin:0 0 12px">錄音時這條會跟著你的聲音跳。都不動就是麥克風沒收到。</p>
    <button class="btn primary" id="rec">先試唱一次（不算數）</button>
    <button class="btn" id="stop" disabled>唱完了</button>
    <div style="border-top:1px solid var(--line);margin:14px 0 0;padding-top:14px">
      <p class="small muted" style="margin:0 0 8px">試唱過、覺得可以了再上台。<b>正式只錄一次。</b></p>
      <button class="btn" id="go" style="border-color:var(--amber);color:var(--amber)">正式上台</button>
    </div>
  </div>
  <div id="sc"></div>
  <p class="small muted">戴耳機、離麥克風近一點會比較準。</p>
  ${pauseBtn()}`;
  const start = async (isOfficial) => {
    official = isOfficial;
    const ti = document.getElementById("tt");
    takeTitle = ti ? (ti.value || "").trim() : "";        // 先抓起來，之後畫面換掉也不影響
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }) }
    catch (e) { alert("拿不到麥克風。"); return }
    chunks = []; mr = new MediaRecorder(stream);
    meter = startMeter(stream, document.getElementById("mtr"));
    document.getElementById("mtr").classList.add("on");
    aborted = false;
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) };
    mr.onstop = async () => { clearInterval(tick); stream.getTracks().forEach(t => t.stop());
      lastLevel = meter ? meter.stop() : null; meter = null;
      const m = document.getElementById("mtr"); if (m) { m.classList.remove("on"); m.querySelector("i").style.width = 0 }
      if (aborted) {
        const g = id => document.getElementById(id);
        ["rec", "go"].forEach(x => { if (g(x)) g(x).disabled = false });
        if (g("rec")) g("rec").textContent = "先試唱一次（不算數）";
        if (g("go")) g("go").textContent = "正式上台";
        if (g("stop")) g("stop").disabled = true;
        if (g("pausebtn")) g("pausebtn").disabled = false;
        if (g("clk")) g("clk").textContent = "0:00";
        if (g("sc")) g("sc").innerHTML = `<div class="card"><p class="small muted" style="margin:0">這次不算，重來就好。</p></div>`;
        return;
      }
      await done(new Blob(chunks, { type: chunks[0] ? chunks[0].type : "audio/webm" })) };
    ["rec", "go"].forEach(x => { const e = document.getElementById(x); if (e) e.disabled = true });
    const lbl = document.getElementById(isOfficial ? "go" : "rec");
    if (lbl) lbl.textContent = isOfficial ? "正式錄音中…" : "錄音中…";
    const sb = document.getElementById("stop"); if (sb) sb.disabled = false;
    const pb = document.getElementById("pausebtn"); if (pb) pb.disabled = true;   // 錄音中不能中途離開
    const scb = document.getElementById("sc"); if (scb) scb.innerHTML = "";
    if (isOfficial) {
      const ab = el(`<button class="btn danger" id="abort">開頭出狀況，這次不算</button>`);
      document.getElementById("sc").appendChild(ab);
      ab.onclick = () => { aborted = true; if (mr && mr.state === "recording") mr.stop() };
      setTimeout(() => { const e = document.getElementById("abort"); if (e) e.remove() }, 20000);
    }
    t0 = Date.now(); mr.start();
    tick = setInterval(() => { const e = document.getElementById("clk");
      if (e) e.textContent = mmss((Date.now() - t0) / 1000) }, 200);
  };
  const done = async (blob) => {
    const $ = id => document.getElementById(id);
    if ($("stop")) $("stop").disabled = true;
    if ($("sc")) $("sc").innerHTML = `<div class="card"><p class="small" style="margin:0">電腦在聽…<b id="pp" class="mono">0%</b></p></div>`;
    const r = await freeAnalyze(blob, p => { const e = $("pp"); if (e) e.textContent = Math.round(p * 100) + "%" });
    PM.last = r;
    const title = takeTitle || "自選曲";
    if (official) {
      await REC.put("take_" + st, blob); delete takeURLs[st];
      takeExt[st] = /mp4|m4a/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
      PM.res[st] = r; PM.title[st] = title;
      saveGame(LASTPHASE);                       // 唱完就存，走人也不會白唱
      const url2 = URL.createObjectURL(blob);
      app.innerHTML = `<p class="eyebrow">${opt.eyebrow}</p><h2>唱完了</h2>
      <p class="muted">《${title}》</p>
      ${freeCard(r, st, url2, false, lastLevel)}
      <button class="btn primary" id="n">上台</button>
      ${pauseBtn()}`;
      document.getElementById("n").onclick = () => opt.onGo(r);
      bindPause();
      return;
    }
    ["rec", "go"].forEach(x => { if ($(x)) $(x).disabled = false });
    if ($("rec")) { $("rec").textContent = "再試一次"; $("rec").classList.remove("primary") }
    if ($("go")) $("go").classList.add("primary");            // 試唱過了，主要動作換成上台
    if ($("pausebtn")) $("pausebtn").disabled = false;
    const url = URL.createObjectURL(blob);
    if ($("sc")) $("sc").innerHTML = freeCard(r, st, url, true, lastLevel);
  };
  document.getElementById("rec").onclick = () => start(false);
  document.getElementById("stop").onclick = () => { if (mr && mr.state === "recording") mr.stop() };
  document.getElementById("go").onclick = () => {
    if (!confirm(`正式上台。只錄一次，唱完就送出，不能重來。要開始嗎？`)) return;
    start(true);
  };
  bindPause();
}
function freeCard(r, st, url, practice, lv) {
  const bar = barOf(st), pass = r.Q >= bar, lw = levelWarn(lv);
  return `<div class="card"><h2 style="font-size:18px">電腦怎麼聽你${practice ? "這一次" : ""}</h2>
    <div class="rowline"><span>音準<span class="small muted">　音有沒有落在半音格上</span></span><span class="mono ${r.pitch>=55?"pos":"neg"}">${r.pitch}</span></div>
    <div class="rowline"><span>律動<span class="small muted">　脈動穩不穩、該用力有沒有用力</span></span><span class="mono ${r.groove>=60?"pos":"neg"}">${r.groove}</span></div>
    <div class="rowline"><span>穩<span class="small muted">　長音撐不撐得住</span></span><span class="mono ${r.steady>=60?"pos":"neg"}">${r.steady}</span></div>
    <div class="rowline"><span>完成度<span class="small muted">　唱多久、用到多寬音域</span></span><span class="mono ${r.body>=70?"pos":"neg"}">${r.body}</span></div>
    <div class="rowline"><span><b>綜合</b>　<span class="small muted">門檻 ${bar}</span></span><span class="mono" style="font-size:22px"><b class="${pass?"pos":"neg"}">${r.Q}</b></span></div>
    ${r.short?`<p class="small" style="color:var(--amber);margin:10px 0 0">只唱了 ${r.sec} 秒，不到 30 秒，總分已經被打折。</p>`:""}
    <p class="small" style="margin:10px 0 0;color:${pass?"var(--cyan)":"var(--red)"}">${freeVerdict(r.Q, st)}${practice?(pass?"　這樣上台可以。":`　還差 ${bar-r.Q} 分。`):""}</p>
    ${lw?`<p class="small" style="margin:8px 0 0;color:var(--amber)">${lw}</p>`:""}
    <p class="small muted" style="margin:6px 0 0">唱了 ${r.sec} 秒、${r.notes} 個音。</p>
    ${url?`<audio controls src="${url}" style="margin-top:10px"></audio>
    <p class="small muted" style="margin:6px 0 0">這段只有你聽得到，不會上傳。</p>`:""}
  </div>`;
}

/* ---------- 自由模式：試分數（不比賽，先量給你看） ---------- */
/* 每一關的門檻。用真人錄音校準過：
   一段唱得完整、大致在調上的表演大約 60；普通水準 70；很不錯 80；幾乎沒有瑕疵 90。 */
const FREEBAR = { blind: 60, pk: 68, night: 76, final: 84 };
const barOf = st => st === "blind" ? FREEBAR.blind : st === "night" ? FREEBAR.night
                  : st === "final" ? FREEBAR.final : FREEBAR.pk;
const barName = st => st === "blind" ? "盲選" : st === "night" ? "決選之夜"
                  : st === "final" ? "決賽" : "PK";
/* 盲選：分數決定幾位導師轉身 */
const turnsFor = Q => Q < 60 ? 0 : Q < 70 ? 1 : Q < 80 ? 2 : Q < 90 ? 3 : 4;
function freeVerdict(Q, st) {
  const b = barOf(st), d = Q - b;
  if (d >= 10) return "輕鬆過關。";
  if (d >= 0) return d <= 3 ? "險過。" : "過了。";
  return d >= -3 ? "只差一點點。" : "差得有點多。";
}
function freeTest() {
  let mr = null, chunks = [], stream = null, t0 = 0, tick = null, meter = null, lastLevel = null;
  app.innerHTML = `<p class="eyebrow">自由模式 · 試分數</p><h2>唱什麼都可以</h2>
  <p class="muted">自己拿別的裝置放伴奏、或直接清唱都行。網站不放任何有版權的音樂，所以這裡沒有伴奏也沒有歌詞。</p>
  <div class="card">
    <p class="small" style="margin:0 0 4px">電腦會聽四件事：</p>
    <div class="rowline"><span class="small">音準</span><span class="small muted">你的音有沒有落在半音格上</span></div>
    <div class="rowline"><span class="small">律動</span><span class="small muted">有沒有一個穩定的脈動在跑、該用力有沒有用力</span></div>
    <div class="rowline"><span class="small">穩</span><span class="small muted">長音撐不撐得住，音高會不會漂、音量會不會忽大忽小</span></div>
    <div class="rowline"><span class="small">完成度</span><span class="small muted">唱了多久、用到多寬的音域</span></div>
    <p class="small muted" style="margin:10px 0 0">唱滿 60 秒完成度才會滿。<b>唱不到 30 秒總分會被打折。</b>戴耳機比較準。</p>
  </div>
  <div class="card">
    <p class="mono" id="clk" style="font-size:34px;margin:0 0 10px;color:var(--amber)">0:00</p>
    <div class="meter" id="mtr"><i></i></div>
    <p class="small muted" style="margin:0 0 12px">錄音時這條會跟著你的聲音跳。都不動就是麥克風沒收到。</p>
    <button class="btn primary" id="rec">開始錄</button>
    <button class="btn" id="stop" disabled>唱完了</button>
  </div>
  <div id="sc"></div>
  <button class="btn" id="back">回上一頁</button>`;
  document.getElementById("back").onclick = () => { if (mr && mr.state === "recording") mr.stop(); freePractice() };
  document.getElementById("rec").onclick = async () => {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }) }
    catch (e) { alert("拿不到麥克風。"); return }
    chunks = []; mr = new MediaRecorder(stream);
    meter = startMeter(stream, document.getElementById("mtr"));
    document.getElementById("mtr").classList.add("on");
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) };
    mr.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach(t => t.stop());
      lastLevel = meter ? meter.stop() : null; meter = null;
      const m = document.getElementById("mtr"); if (m) { m.classList.remove("on"); m.querySelector("i").style.width = 0 }
      await done(new Blob(chunks, { type: chunks[0] ? chunks[0].type : "audio/webm" }));
    };
    document.getElementById("rec").disabled = true;
    document.getElementById("rec").textContent = "錄音中…";
    document.getElementById("stop").disabled = false;
    document.getElementById("sc").innerHTML = "";
    t0 = Date.now(); mr.start();
    tick = setInterval(() => { const e = document.getElementById("clk");
      if (e) e.textContent = mmss((Date.now() - t0) / 1000) }, 200);
  };
  document.getElementById("stop").onclick = () => { if (mr && mr.state === "recording") mr.stop() };
  const done = async (blob) => {
    document.getElementById("stop").disabled = true;
    document.getElementById("sc").innerHTML = `<div class="card"><p class="small" style="margin:0">電腦在聽…<b id="pp" class="mono">0%</b></p></div>`;
    const r = await freeAnalyze(blob, p => { const e = document.getElementById("pp"); if (e) e.textContent = Math.round(p * 100) + "%" });
    const url = URL.createObjectURL(blob);
    const cmp = r.Q >= FREEBAR.final ? "這個分數在自由模式可以一路唱到冠軍。"
      : r.Q >= FREEBAR.night ? `過得了決選之夜（${FREEBAR.night}），離冠軍還差 ${FREEBAR.final - r.Q} 分。`
      : r.Q >= FREEBAR.pk ? `過得了 PK（${FREEBAR.pk}），決選之夜還差 ${FREEBAR.night - r.Q} 分。`
      : r.Q >= FREEBAR.blind ? `進得了盲選（${FREEBAR.blind}），PK 還差 ${FREEBAR.pk - r.Q} 分。`
      : `連盲選的 ${FREEBAR.blind} 分都還沒到，這樣上台沒有人會轉身。`;
    document.getElementById("rec").disabled = false;
    document.getElementById("rec").textContent = "再錄一次";
    document.getElementById("sc").innerHTML = `
    <div class="card"><h2 style="font-size:18px">電腦怎麼聽你</h2>
      <div class="rowline"><span>音準</span><span class="mono ${r.pitch>=70?"pos":"neg"}">${r.pitch}</span></div>
      <div class="rowline"><span>律動</span><span class="mono ${r.groove>=60?"pos":"neg"}">${r.groove}</span></div>
      <div class="rowline"><span>穩</span><span class="mono ${r.steady>=60?"pos":"neg"}">${r.steady}</span></div>
      <div class="rowline"><span>完成度</span><span class="mono ${r.body>=70?"pos":"neg"}">${r.body}</span></div>
      <div class="rowline"><span><b>綜合</b></span><span class="mono"><b>${r.Q}</b></span></div>
      ${r.short?`<p class="small" style="color:var(--amber);margin:10px 0 0">你只唱了 ${r.sec} 秒，不到 30 秒，總分已經被打折。</p>`:""}
      <p class="small muted" style="margin:10px 0 0">唱了 ${r.sec} 秒、${r.notes} 個音。</p>
      ${levelWarn(lastLevel)?`<p class="small" style="margin:8px 0 0;color:var(--amber)">${levelWarn(lastLevel)}</p>`:""}
      <p class="small" style="margin:8px 0 0;color:var(--cyan)">${cmp}<br>
        門檻：盲選 ${FREEBAR.blind}・PK ${FREEBAR.pk}・決選之夜 ${FREEBAR.night}・決賽 ${FREEBAR.final}。</p>
      <audio controls src="${url}" style="margin-top:10px"></audio>
      <p class="small muted" style="margin:6px 0 0">這段只有你聽得到，不會上傳。</p>
    </div>`;
  };
}

/* ---------- 練歌大廳：不比賽，十二首都可以練 ---------- */
const ALLSONGS = BLIND_POOL.concat(["01_風向","03_定影","04_繞路","05_會客時間"]);
const SONGROLE = {"01_風向":"PK 曲・垂直","03_定影":"PK 曲・控制","04_繞路":"PK 曲・速度","05_會客時間":"決賽曲"};
function freePractice() {
  app.innerHTML = `<p class="eyebrow">練歌大廳</p><h2>十二首都可以練</h2>
  <p class="muted">這裡不算成績。先把想唱的練熟，再去比賽。</p>
  <p class="small muted">錄完會給你音準／節奏／完整度，還會告訴你這個分數大概能不能過關。</p>
  <div id="s"></div>
  <div class="card">
    <h2 style="font-size:18px;margin-top:0">自由模式 · 試分數 🎤</h2>
    <p class="small muted" style="margin:0 0 10px">唱什麼都可以——自己放伴奏、或清唱。電腦不需要參考旋律也能給你音準／律動／穩／完成度。
    這是自由模式的評分引擎，還沒接進比賽，先量給你看準不準。</p>
    <button class="btn" id="ft">去試分數</button>
  </div>
  <button class="btn" id="back">回開場</button>`;
  const box = document.getElementById("s");
  ALLSONGS.forEach(k => {
    const b = el(`<button class="btn" style="text-align:left">《${sname(k)}》
      <span class="small muted">　${SONGROLE[k] ? SONGROLE[k] + "・" : "盲選曲・"}${SONGHINT[k]||""}</span></button>`);
    b.onclick = () => practiceRoom({ stage: "free_" + k, songKey: k, free: true,
      eyebrow: "練歌大廳", note: SONGROLE[k] || "盲選曲", onGo: freePractice });
    box.appendChild(b);
  });
  document.getElementById("ft").onclick = freeTest;
  document.getElementById("back").onclick = intro;
}
function qNote(r) {
  if (r.Q >= 75) return "這一次唱得很穩，上台不會有問題。";
  if (r.Q >= 56) return "堪用。再抓一下" + (r.pitch < r.rhythm ? "音準" : "節奏") + "會更好。";
  if (r.complete < 50) return "有大段沒有出聲——是不是伴奏跑掉了、還是麥克風沒收到？";
  if (r.pitch < 45) return "音準離參考的旋律有點遠。先只播伴奏跟著哼幾次再錄。";
  return "還不到能上台的樣子，再練幾次。";
}

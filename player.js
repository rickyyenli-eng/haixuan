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
  return {
    async put(k, blob) { const d = await open(); return new Promise((res, rej) => {
      const t = d.transaction("takes", "readwrite"); t.objectStore("takes").put(blob, k);
      t.oncomplete = res; t.onerror = () => rej(t.error) }) },
    async get(k) { const d = await open(); return new Promise((res, rej) => {
      const q = d.transaction("takes", "readonly").objectStore("takes").get(k);
      q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error) }) },
    async wipe() { const d = await open(); return new Promise(res => {
      const t = d.transaction("takes", "readwrite"); t.objectStore("takes").clear(); t.oncomplete = res }) }
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
  const Q = Math.round(pitch * 0.5 + rhythm * 0.3 + complete * 0.2);
  return { pitch, rhythm, complete, Q, off: bestOff * 0.04, oct: bestOct };
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
  const Q = res.Q, D = Math.max(-1.3, Math.min(1.3, (Q - 72) / 30 * 1.3));
  const strain = Math.max(0, Math.min(4, 4 - res.pitch / 25));
  const rural = RURAL(PM.home);
  const npcs = NPCLIST().map(x => npcScoreLocal(x, strain, true, rural));
  const judge = Math.max(1, Math.min(10, npcs.reduce((a, b) => a + b, 0) / npcs.length + D));
  const aud = Math.max(1, Math.min(10,
    7 - (heard || 0) * 0.3 - ((order || 8) - 1) * 0.05 + 0.4 - Math.abs(strain - 1) * 0.3 + D * 0.5));
  return { npcs, judge, aud, total: judge * 0.5 + aud * 0.5, D, strain };
}

/* ---------- 學員狀態 ---------- */
const PM = { on: false, me: null, name: "", home: "", say: "", voice: "男",
             song: {}, res: {}, mhash: {}, key: {}, last: null };
function pmReset() { PM.on = false; PM.me = null; PM.name = ""; PM.home = ""; PM.say = ""; PM.voice = "男";
  PM.song = {}; PM.res = {}; PM.mhash = {}; PM.key = {}; PM.last = null; PM.out = null }
function pmSave() { return { on: PM.on, me: PM.me, name: PM.name, home: PM.home, say: PM.say,
  voice: PM.voice, song: PM.song, res: PM.res, mhash: PM.mhash, key: PM.key, out: PM.out || null } }
function pmLoad(o) { if (o) Object.assign(PM, o) }

/* ---------- 建角色 ---------- */
function playerSetup() {
  app.innerHTML = `
  <p class="eyebrow">學員模式</p><h1>你要上台</h1>
  <p class="muted">十六個人裡面有一個是你。你會用這台手機（或電腦）的麥克風唱給四位電腦導師聽。</p>
  <div class="card">
    <p class="small" style="margin:0 0 4px">錄音只存在這台裝置的瀏覽器裡，不會上傳、也不會傳給別人。換一台裝置就聽不到了。</p>
    <p class="small muted" style="margin:8px 0 0">練歌室裡可以切男聲／女聲導唱、升降 key、放慢旋律、伴奏和人聲導唱切換。</p>
  </div>
  <div class="card">
    <label class="small">你在台上的名字</label>
    <input id="pn" maxlength="8" placeholder="想一個藝名" style="width:100%;box-sizing:border-box;background:#12101a;border:1px solid var(--line);color:var(--paper);padding:10px;font-family:var(--sans);font-size:15px;margin:6px 0 14px">
    <label class="small">你的音域</label>
    <div id="vsel" style="margin:6px 0 14px"></div>
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
  const paintV = () => { vs.innerHTML = "";
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
  app.innerHTML = `<p class="eyebrow">學員模式 · 麥克風</p><h2>先讓瀏覽器問你要不要開麥克風</h2>
  <p class="muted">按下去之後，瀏覽器會跳出詢問。要按「允許」才能錄。</p>
  <button class="btn primary" id="ask">開麥克風</button>
  <button class="btn" id="back">回上一頁</button>`;
  document.getElementById("back").onclick = playerSetup;
  document.getElementById("ask").onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      st.getTracks().forEach(t => t.stop());
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
/* 盲選：八選一 */
function pickBlindSong() {
  app.innerHTML = `<p class="eyebrow">學員模式 · 盲選自選曲</p><h2>你要唱哪一首</h2>
  <p class="muted">八首裡面挑一首。<b>只有盲選這一關可以自己選</b>，後面幾關都是被指定的。</p>
  <p class="small muted">挑完之後你會先進練歌室，想練多久就練多久。</p>
  <div id="s"></div>`;
  BLIND_POOL.forEach(k => {
    const b = el(`<button class="btn">《${sname(k)}》</button>`);
    b.onclick = () => { PM.song.blind = k; startPlayerGame() };
    document.getElementById("s").appendChild(b);
  });
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

/* ---------- 練歌室 ---------- */
/* opt = {stage, songKey, eyebrow, note, onGo} */
function practiceRoom(opt) {
  const k = opt.songKey;
  const st = { g: hasVoice(k, PM.voice) ? PM.voice : (hasVoice(k,"男") ? "男" : "女"),
               key: 0, speed: 1, guide: "bk" };
  let mr = null, chunks = [], stream = null, official = false, chain = null;

  const hash = () => mhash(k, st.g);
  const srcURL = () => st.guide === "bk" ? BKURL(hash()) : MIXURL(hash());

  app.innerHTML = `<p class="eyebrow">${opt.eyebrow}</p><h2>練歌室</h2>
  <p class="muted">《${sname(k)}》${opt.note ? "　" + opt.note : ""}</p>
  <audio id="bk" preload="auto" crossorigin="anonymous"></audio>
  <div class="bar"><i id="prog"></i></div>
  ${lyricBox()}
  <div class="card" id="ctl">
    <div class="rowline"><span class="small">導唱聲線</span><span id="gbtns"></span></div>
    <div class="rowline"><span class="small">聽什麼</span><span id="vbtns"></span></div>
    <div class="rowline"><span class="small">Key <b class="mono" id="kv">原 key</b></span><span id="kbtns"></span></div>
    <div class="rowline"><span class="small">速度 <b class="mono" id="sv">1.0×</b></span><span id="sbtns"></span></div>
    <p class="small muted" id="cnote" style="margin:10px 0 0"></p>
  </div>
  <div class="card">
    <button class="btn" id="only">播放（自己跟著唱）</button>
    <button class="btn" id="rec">開始錄（試唱，可以重來）</button>
    <button class="btn" id="stop" disabled>停</button>
  </div>
  <div id="sc"></div>
  <div class="card">
    <p class="small muted" style="margin:0 0 10px">覺得可以了再上台。<b>正式比賽只錄一次，不能重來。</b>
    正式那一次會自動切回<b>只有伴奏、原速</b>，Key 會照你現在選的。</p>
    <button class="btn primary" id="go">開始比賽</button>
  </div>
  <p class="small muted">歌詞會跟著伴奏跑。耳機建議戴上，不然伴奏會被錄進去，音準會被拉掉。</p>`;

  const bk = document.getElementById("bk");
  bk.ontimeupdate = () => { const e=document.getElementById("prog"); if(e) e.style.width = (bk.currentTime/(bk.duration||1)*100)+"%" };

  const chip = (box, label, on, dis, fn) => {
    const b = el(`<button class="btn" style="padding:6px 12px;margin:0 0 0 6px;font-size:13px${on?";border-color:var(--amber);color:var(--amber)":""}"${dis?" disabled":""}>${label}</button>`);
    if (!dis) b.onclick = fn;
    box.appendChild(b); return b;
  };
  function reload(keepTime) {
    const t = keepTime ? bk.currentTime : 0, playing = !bk.paused;
    bk.src = srcURL(); bk.currentTime = t;
    attachLyrics(bk, hash(), app.querySelector(".lyric"));
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
    [0.6,0.75,0.9,1].forEach(v=>chip(sb,v.toFixed(2).replace(/0$/,"")+"×",st.speed===v,false,()=>{st.speed=v;setSpeed(bk,v);paint()}));
    document.getElementById("kv").textContent=KEYNAME(st.key);
    document.getElementById("sv").textContent=st.speed+"×";
    const n=[];
    if(!hasVoice(k,"女")) n.push("這首歌目前只有男聲版本。");
    if(chain&&!chain.ok&&st.key!==0) n.push("這個瀏覽器不支援即時移調，Key 會沒有作用。");
    if(st.speed!==1) n.push("放慢只是練習用，正式比賽一律原速。");
    document.getElementById("cnote").textContent=n.join(" ");
  }
  async function applyKey(){ if(!chain) chain=await attachChain(bk); chain.setKey(st.key) }

  reload(false); paint();

  const setBusy = b => ["only","rec","go"].forEach(x=>{const e=document.getElementById(x); if(e) e.disabled=b});
  document.getElementById("only").onclick = async e => {
    if (!bk.paused) { bk.pause(); bk.currentTime = 0; e.target.textContent = "播放（自己跟著唱）"; return }
    if (!chain) chain = await attachChain(bk);
    try { await audioCtx().resume() } catch (x) {}
    chain.setKey(st.key); setSpeed(bk, st.speed);
    bk.currentTime = 0; bk.play(); e.target.textContent = "停止播放"; paint();
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
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await finishTake(new Blob(chunks, { type: chunks[0] ? chunks[0].type : "audio/webm" }));
    };
    document.getElementById("sc").innerHTML = "";
    setBusy(true); document.getElementById("stop").disabled = false;
    document.getElementById("rec").textContent = isOfficial ? "正式錄音中…" : "錄音中…";
    bk.currentTime = 0; bk.play(); mr.start();
    bk.onended = () => { if (mr && mr.state === "recording") mr.stop() };
  };
  const finishTake = async (blob) => {
    bk.pause();
    document.getElementById("stop").disabled = true;
    document.getElementById("sc").innerHTML =
      `<div class="card"><p class="small" style="margin:0">電腦在聽…<b id="pp" class="mono">0%</b></p></div>`;
    const useKey = st.speed === 1 ? st.key : 0;
    const r = await analyzeTake(blob, hash(), useKey,
      p => { const e = document.getElementById("pp"); if (e) e.textContent = Math.round(p * 100) + "%" });
    r.slow = st.speed !== 1;
    PM.last = r;
    if (official) {
      await REC.put("take_" + opt.stage, blob);
      delete takeURLs[opt.stage];
      PM.res[opt.stage] = r; PM.song[opt.stage] = k;
      PM.mhash[opt.stage] = hash(); PM.key[opt.stage] = st.key; PM.voice = st.g;
      return opt.onGo(r);
    }
    setBusy(false);
    document.getElementById("rec").textContent = "再錄一次";
    const url = URL.createObjectURL(blob);
    document.getElementById("sc").innerHTML = `
    <div class="card"><h2 style="font-size:18px">電腦怎麼聽你這一次</h2>
      <p class="small muted" style="margin:0 0 10px">${st.g}聲導唱・${KEYNAME(st.key)}・${st.speed}×${st.guide==="mix"?"・原曲帶唱":""}</p>
      ${r.slow?`<p class="small" style="color:var(--amber);margin:0 0 10px">你剛剛是放慢唱的，分數只能當參考。要看真的分數請切回 1×。</p>`:""}
      <div class="rowline"><span>音準</span><span class="mono ${r.pitch>=60?"pos":"neg"}">${r.pitch}</span></div>
      <div class="rowline"><span>節奏</span><span class="mono ${r.rhythm>=60?"pos":"neg"}">${r.rhythm}</span></div>
      <div class="rowline"><span>完整度</span><span class="mono ${r.complete>=60?"pos":"neg"}">${r.complete}</span></div>
      <div class="rowline"><span><b>綜合</b></span><span class="mono"><b>${r.Q}</b></span></div>
      <p class="small muted" style="margin:10px 0 0">${qNote(r)}</p>
      <audio controls src="${url}" style="margin-top:10px"></audio>
      <p class="small muted" style="margin:6px 0 0">這段只有你聽得到。</p>
    </div>`;
  };
  document.getElementById("rec").onclick = () => startRec(false);
  document.getElementById("stop").onclick = () => { if (mr && mr.state === "recording") mr.stop() };
  document.getElementById("go").onclick = () => {
    if (!confirm(`正式上台唱《${sname(k)}》（${st.g}聲・${KEYNAME(st.key)}）。只錄一次，唱完就送出，不能重來。要開始嗎？`)) return;
    document.getElementById("go").textContent = "正式錄音中…";
    startRec(true);
  };
}
function qNote(r) {
  if (r.Q >= 80) return "這一次唱得很穩，上台不會有問題。";
  if (r.Q >= 65) return "堪用。再抓一下" + (r.pitch < r.rhythm ? "音準" : "節奏") + "會更好。";
  if (r.complete < 50) return "有大段沒有出聲——是不是伴奏跑掉了、還是麥克風沒收到？";
  if (r.pitch < 45) return "音準離參考的旋律有點遠。先只播伴奏跟著哼幾次再錄。";
  return "還不到能上台的樣子，再練幾次。";
}

// ===== Sample data (easy to replace) =====
const SAMPLE = [
  { id: "TXN001", sender: "Punit", receiver: "Rahul", amount: 500, method: "UPI", status: "Pending" },
  { id: "TXN002", sender: "Aman", receiver: "Ravi", amount: 1200, method: "Debit Card", status: "Success" },
  { id: "TXN003", sender: "Neha", receiver: "Punit", amount: 750, method: "UPI", status: "Success" },
  { id: "TXN004", sender: "Arjun", receiver: "Mohit", amount: 200, method: "Wallet", status: "Pending" },
  { id: "TXN005", sender: "Priya", receiver: "Simran", amount: 1500, method: "Net Banking", status: "Success" }
];
const KEY = "dptp_state";
const $ = id => document.getElementById(id);
const fmt = n => "₹" + Number(n).toLocaleString("en-IN");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ===== Queue data structure (FIFO) =====
class Queue {
  constructor() { this.items = []; }
  enqueue(x) { this.items.push(x); }            // add at REAR  - O(1)
  dequeue() { return this.items.shift(); }      // remove from FRONT
  peek() { return this.items[0]; }              // look at FRONT - O(1)
  isEmpty() { return this.items.length === 0; }
}

let txns = [], queue = new Queue(), sortView = [], running = false;

// ===== Storage =====
let online=false;
function save() { /* the server stores everything now */ }
function dbState() { $("dbstat").textContent = online ? "● Database connected" : "● Local mode (no server)"; $("dbstat").classList.toggle("on", online); }
function apply(d) { txns = d.txns; queue = new Queue(); d.q.map(id => txns.find(t => t.id === id)).filter(Boolean).forEach(t => queue.enqueue(t)); sortView = [...txns]; }
async function load() { lastSig = ""; await refresh(true); }
function emptyData() { txns = []; queue = new Queue(); sortView = []; }
function resetData() {
  localStorage.removeItem(ukey());
  txns = JSON.parse(JSON.stringify(SAMPLE)); queue = new Queue();
  txns.filter(t => t.status === "Pending").forEach(t => queue.enqueue(t));
  sortView = [...txns];
  ["searchOut", "sortOut", "sortMsg", "queueMsg"].forEach(i => $(i).innerHTML = ""); $("sid").value = "";
  render();
}

// ===== UI helpers =====
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t.h); t.h = setTimeout(() => t.classList.remove("show"), 2500); }
function ask(msg, cb) { $("dmsg").textContent = msg; $("dlg").showModal(); $("yes").onclick = () => { $("dlg").close(); cb(); }; }
function go(id) {
  if (PROTECTED.includes(id) && !user) return openAuth("Log in to access your transactions.");
  scrollTo(0, 0);
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.dataset.go === id));
  $("top").classList.remove("open"); window.scrollTo(0, 0);
}
const badge = s => `<span class="badge s-${esc(s)}">${esc(s)}</span>`;

// ===== Rendering =====
function render() {
  const count = s => txns.filter(t => t.status === s).length;
  const ok = t => t.status === "Success", sent = txns.filter(t => ok(t) && t.dir === "out").reduce((a, t) => a + t.amount, 0), recv = txns.filter(t => ok(t) && t.dir === "in").reduce((a, t) => a + t.amount, 0);
  const cards = [["Balance", fmt(me.balance)], ["Total Sent", fmt(sent)], ["Total Received", fmt(recv)], ["Pending Payments", count("Pending")], ["All Transactions", txns.length]];
  $("wallet").innerHTML = me.fid ? `<div><small class="sub">Welcome back</small><h2>${esc(me.name)}</h2></div><div class="wid">${esc(me.fid)}@payflow <button class="btn ghost2 mini" data-copy="${esc(me.fid)}@payflow">Copy ID</button></div>` : "<p class='sub'>Start the server (npm start) to use your wallet.</p>";
  $("stats").innerHTML = cards.map(c => `<div class="card stat"><b>${c[1]}</b><span>${c[0]}</span></div>`).join("");
  $("chart").innerHTML = ["Success", "Pending", "Failed"].map(s =>
    `<div class="chartrow"><span style="width:60px">${s}</span><i style="width:${txns.length ? count(s) / txns.length * 70 : 0}%;min-width:4px"></i><b>${count(s)}</b></div>`).join("");
  $("recent").innerHTML = "<tr><th>Transaction ID</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Status</th><th>Date/Time</th><th>Action</th></tr>" +
    txns.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.sender)}</td><td>${esc(t.receiver)}</td><td class="${t.dir}">${t.dir === "in" ? "+" : "−"}${fmt(t.amount)}</td><td>${badge(t.status)}</td><td>${t.time || "—"}</td><td><a href="#" data-view="${esc(t.id)}">View</a></td></tr>`).join("");
  $("queueView").innerHTML = queue.isEmpty() ? "<p class='sub'>Queue is empty.</p>" : queue.items.map((t, i, a) =>
    `<div class="qcard">${i === 0 ? '<span class="tag">FRONT ↓</span>' : ""}${i === a.length - 1 ? '<span class="tag r" style="left:auto;right:8px">REAR ↓</span>' : ""}
    <b>${esc(t.id)}</b><br>${esc(t.sender)} → ${esc(t.receiver)}<br>${fmt(t.amount)}<br>${badge(t.status)}<br><button class="btn ghost2 mini" data-cancel="${esc(t.id)}">Cancel</button></div>${i < a.length - 1 ? "→" : ""}`).join("");
  $("fid").value = "";
  if (!running) drawBars();
  flair();
  hist();
  save();
}

// ===== Wallet actions (the server holds the money) =====
let me = { name: "", fid: "", balance: 0 }, lastSig = "";
async function api(path, body) {
  const r = await fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  let d = {}; try { d = await r.json(); } catch (e) { /* no body */ } return { ok: r.ok, d };
}
async function refresh(force) {
  if (!user || !server) return;
  try {
    const r = await fetch("/api/wallet"); if (!r.ok) return; const d = await r.json(), sig = JSON.stringify(d);
    if (!force && sig === lastSig) return; lastSig = sig;
    me = d.me; txns = d.txns; queue = new Queue(); d.pending.forEach(id => { const t = txns.find(x => x.id === id); if (t) queue.enqueue(t); }); sortView = [...txns]; render();
  } catch (e) { /* server stopped */ }
}
setInterval(() => { if (user && server && !document.hidden && !running) refresh(); }, 4000);   // receivers see new money without reloading
$("addBtn").onclick = () => {
  if (!server) return $("addErr").textContent = "Start the server (npm start) to send money.";
  const fid = $("fsender").value.trim().toLowerCase().replace(/@payflow$/, ""), name = $("freceiver").value.trim(), amount = Number($("famount").value);
  const err = !fid ? "Enter the receiver's PayFlow ID." : !name ? "Enter the receiver's name." : !(amount > 0) ? "Enter a valid amount." : "";
  $("addErr").textContent = err; if (err) return;
  ask(`Send ${fmt(amount)} to ${name} (${fid}@payflow)?`, async () => {
    const { ok, d } = await api("send", { fid, name, amount }); if (!ok) return $("addErr").textContent = d.error || "Could not send.";
    ["fsender", "freceiver", "famount"].forEach(i => $(i).value = ""); await refresh(true); toast(`${d.txn} added to your queue.`);
  });
};
$("processBtn").onclick = async () => {
  if (queue.isEmpty()) { $("queueMsg").textContent = "No pending payments in your queue."; return toast("Nothing to process."); }
  $("queueMsg").textContent = "";
  const f = document.querySelector("#queueView .qcard"); if (f) { f.classList.add("out"); await sleep(380); }   // dequeue the FRONT payment
  const { ok, d } = await api("process"); await refresh(true);
  if (!ok) return toast(d.error || "Could not process.");
  if (d.status === "Failed") { $("queueMsg").textContent = d.txn + " failed: not enough balance."; return toast("Payment failed."); }
  toast(`${d.txn} sent. Your balance: ${fmt(d.balance)}`);
};
async function cancel(id) { const { ok, d } = await api("cancel/" + id); await refresh(true); toast(ok ? id + " cancelled." : d.error || "Could not cancel."); }
document.addEventListener("click", e => {
  const c = e.target.closest("[data-cancel]"); if (c) cancel(c.dataset.cancel);
  const b = e.target.closest("[data-copy]"); if (b) { navigator.clipboard?.writeText(b.dataset.copy); toast("ID copied."); }
});

// ===== Linear Search algorithm =====
function linearSearch(arr, id) {
  let checked = 0;
  for (let i = 0; i < arr.length; i++) {   // check each transaction in order
    checked++;
    if (arr[i].id === id) return { item: arr[i], checked };
  }
  return { item: null, checked };
}
function doSearch(idIn) {
  go("search"); if (idIn) $("sid").value = idIn;
  const id = $("sid").value.trim().toUpperCase();
  if (!id) return ($("searchOut").innerHTML = "<p class='err'>Please enter a Transaction ID.</p>");
  const r = linearSearch(txns, id), t = r.item;
  $("searchOut").innerHTML = (t ? `<div class="res"><h3>Transaction Found ✓</h3>Transaction ID: ${esc(t.id)}<br>Sender: ${esc(t.sender)}<br>Receiver: ${esc(t.receiver)}<br>Amount: ${fmt(t.amount)}<br>Payment Method: ${esc(t.method)}<br>Status: ${t.status}</div>`
    : `<div class="res no"><h3>Transaction not found.</h3></div>`) +
    `<div class="res"><b>Search Completed</b><br>Transactions Checked: ${r.checked}<br>Algorithm: Linear Search<br>Complexity: O(n)</div>`;
}
$("searchBtn").onclick = () => doSearch();
$("sid").onkeydown = e => { if (e.key === "Enter") doSearch(); };

// ===== Bubble Sort algorithm =====
// Repeatedly compares adjacent items and swaps them if out of order.
function bubbleSort(arr, key, asc) {
  const a = [...arr], steps = []; let comparisons = 0, swaps = 0;
  for (let i = 0; i < a.length - 1; i++) {          // outer loop: passes
    let swapped = false;
    for (let j = 0; j < a.length - i - 1; j++) {    // inner loop: adjacent pairs
      comparisons++;
      const wrong = asc ? a[j][key] > a[j + 1][key] : a[j][key] < a[j + 1][key];
      if (wrong) { [a[j], a[j + 1]] = [a[j + 1], a[j]]; swaps++; swapped = true; }
      steps.push({ j, wrong });
    }
    if (!swapped) break;                            // optimization: already sorted -> best case O(n)
  }
  return { sorted: a, steps, comparisons, swaps };
}

// ===== Sorting visualization =====
const sleep = ms => new Promise(r => setTimeout(r, ms));
function drawBars(hi = {}) {
  const max = Math.max(...sortView.map(t => t.amount), 1);
  $("bars").innerHTML = sortView.map((t, i) =>
    `<div class="bar ${hi.a === i || hi.b === i ? hi.cls : ""}" style="height:${t.amount / max * 100}%"><small>${t.id.slice(3)}<br>${t.amount}</small></div>`).join("");
}
async function runSort(key, asc) {
  if (running) return; running = true;
  const r = bubbleSort(sortView, key, asc), v = [...sortView];
  for (const s of r.steps) {
    sortView = v; $("sortMsg").textContent = `Comparing ${fmt(v[s.j].amount)} and ${fmt(v[s.j + 1].amount)}`;
    drawBars({ a: s.j, b: s.j + 1, cls: "cmp" }); await sleep(350);
    if (s.wrong) { [v[s.j], v[s.j + 1]] = [v[s.j + 1], v[s.j]]; $("sortMsg").textContent = "Swapping"; drawBars({ a: s.j, b: s.j + 1, cls: "swp" }); await sleep(350); }
  }
  snap("Sorted by " + key + (asc ? " ↑" : " ↓")); txns = r.sorted; sortView = [...txns]; running = false;   // apply sorted order to the data
  $("sortMsg").textContent = "Sorting complete."; render();
  $("sortOut").innerHTML = `<div class="res"><b>Sorting Completed</b><br>Comparisons: ${r.comparisons}<br>Swaps: ${r.swaps}<br>Algorithm: Bubble Sort<br>Complexity: O(n²)</div>`;
}
document.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { const [k, a] = b.dataset.sort.split(","); runSort(k, a === "1"); });
$("sortReset").onclick = () => { if (running) return; sortView = [...txns]; $("sortMsg").textContent = ""; $("sortOut").innerHTML = ""; drawBars(); };

// ===== Navigation & reset =====
document.querySelectorAll("[data-go]").forEach(a => a.onclick = () => go(a.dataset.go));
$("burger").onclick = () => $("top").classList.toggle("open");
$("reset").onclick = () => ask("Are you sure you want to reset the transaction data?", () => { snap("Reset demo data"); resetData(); toast("Demo data restored."); });
$("clear").onclick = () => ask("Clear local data and restore the sample transactions?", () => { snap("Cleared all transactions"); emptyData(); localStorage.removeItem(ukey()); render(); toast("All transactions cleared."); });



$("recent").onclick = e => { const a = e.target.closest("[data-view]"); if (a) { e.preventDefault(); doSearch(a.dataset.view); } };
$("no").onclick = () => $("dlg").close();

// ===== Flowcharts (generated SVG) =====
const FC = [
  ["Add Transaction — Enqueue", [["t", "Start"], ["io", "Enter sender, receiver, amount"], ["d", "Input valid?", { y: "Yes", s: 1, sl: "No" }], ["p", "Create TXN (status = Pending)"], ["p", "Enqueue at REAR · O(1)"], ["p", "Save to database"], ["t", "End"]]],
  ["Process Transaction — Dequeue", [["t", "Start"], ["d", "Queue empty?", { y: "No", s: 5, sl: "Yes" }], ["p", "Dequeue from FRONT · O(1)"], ["p", "Set status = Success"], ["p", "Save to database"], ["t", "End"]]],
];
function flow(title, nodes) {
  const NS = "http://www.w3.org/2000/svg", W = 240, H = 44, G = 30, cx = 130;
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.append(e); return e; };
  const ys = nodes.map((_, i) => 24 + i * (H + G));
  const svg = el("svg", { viewBox: `0 0 ${cx + W / 2 + 50 + nodes.length * 9} ${ys[ys.length - 1] + H + 24}`, class: "fc", role: "img", "aria-label": title });
  const defs = el("defs", {}, svg); const m = el("marker", { id: "ar", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs); el("path", { d: "M0 0L10 5L0 10z" }, m);
  const txt = (x, y, t) => { el("text", { x, y, class: "fl" }, svg).textContent = t; };
  const line = pts => el("polyline", { points: pts.join(" "), class: "fe", "marker-end": "url(#ar)" }, svg);
  let lane = 0;
  const down = (i, lab) => { const y1 = ys[i] + H; line([`${cx},${y1}`, `${cx},${ys[i + 1]}`]); if (lab) txt(cx + 6, y1 + 18, lab); };
  const side = (i, j, lab) => { const x1 = cx + W / 2, L = x1 + 18 + lane++ * 9, a = ys[i] + H / 2, b = ys[j] + H / 2; line([`${x1},${a}`, `${L},${a}`, `${L},${b}`, `${x1},${b}`]); if (lab) txt(x1 + 4, a - 5, lab); };
  nodes.forEach(([k, t, o = {}], i) => {
    const g = el("g", { class: "fn " + k }, svg), y = ys[i];
    if (k === "d") el("polygon", { points: `${cx},${y} ${cx + W / 2},${y + H / 2} ${cx},${y + H} ${cx - W / 2},${y + H / 2}` }, g);
    else el("rect", { x: cx - W / 2, y, width: W, height: H, rx: k === "t" ? H / 2 : k === "io" ? 4 : 10 }, g);
    el("text", { x: cx, y: y + H / 2 + 4, "text-anchor": "middle" }, g).textContent = t;
    if (o.to != null) side(i, o.to); else if (k === "d") { down(i, o.y); side(i, o.s, o.sl); } else if (i < nodes.length - 1) down(i);
  });
  const card = document.createElement("div"); card.className = "card";
  card.innerHTML = `<div class="row"><h3 style="flex:1;margin:0">${esc(title)}</h3><button class="btn alt">▶ Walkthrough</button></div>`;
  card.append(svg);
  card.querySelector("button").onclick = async () => { const gs = [...svg.querySelectorAll(".fn")]; gs.forEach(g => g.classList.remove("done")); for (const [i, g] of gs.entries()) { g.style.setProperty("--hc", 20 + i * 22); g.classList.add("hot"); await sleep(520); g.classList.remove("hot"); g.classList.add("done"); } };
  return card;
}
$("flows").append(...FC.map(([t, n]) => flow(t, n)));




// ===== Homepage effects =====
const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches, homeOn = () => $("home").classList.contains("active");
(async () => {
  const PH = ["move through a Queue.", "get found by Linear Search.", "fall into order with Bubble Sort.", "prove themselves with Big-O."]; let i = 0;
  while (true) {
    const p = PH[i++ % PH.length];
    for (let c = 1; c <= p.length; c++) { $("typed").textContent = p.slice(0, c); await sleep(reduce ? 0 : 45); }
    await sleep(1500);
    for (let c = p.length; c >= 0; c--) { $("typed").textContent = p.slice(0, c); await sleep(reduce ? 0 : 22); }
  }
})();
(function () {   // live Bubble Sort in the hero
  const box = $("heroBars"); let a, i, j, sw, hold = 0;
  const fresh = () => { a = Array.from({ length: 12 }, () => 20 + Math.random() * 80 | 0); i = j = 0; sw = false; box.classList.remove("done"); };
  const draw = (h = -1, cls = "") => box.innerHTML = a.map((v, k) => `<i class="${k === h || k === h + 1 ? cls : ""}" style="height:${v}%"></i>`).join("");
  fresh(); draw();
  setInterval(() => {
    if (!homeOn() || document.hidden || reduce) return;
    if (hold > 0) { if (--hold === 0) { fresh(); draw(); } return; }
    if (i >= a.length - 1) { draw(); box.classList.add("done"); hold = 10; return; }
    if (j >= a.length - i - 1) { i = sw ? i + 1 : a.length; j = 0; sw = false; return; }
    if (a[j] > a[j + 1]) { [a[j], a[j + 1]] = [a[j + 1], a[j]]; sw = true; draw(j, "swp"); } else draw(j, "cmp");
    j++;
  }, 240);
})();
(function () {   // drifting payment network
  const c = $("fx"), x = c.getContext("2d"); let w = 0, h = 0, P = [];
  new ResizeObserver(() => { w = c.width = c.offsetWidth; h = c.height = c.offsetHeight; P = Array.from({ length: Math.min(60, w / 14 | 0) }, () => ({ x: Math.random() * w, y: Math.random() * h, v: .3 + Math.random() * .9, r: 1 + Math.random() * 2 })); }).observe(c);
  (function loop() {
    if (homeOn() && !document.hidden) {
      x.clearRect(0, 0, w, h);
      P.forEach(p => { if (!reduce) p.x = (p.x + p.v) % w; });
      P.forEach((a, n) => {
        x.fillStyle = "#b9977f"; x.beginPath(); x.arc(a.x, a.y, a.r, 0, 7); x.fill();
        for (let k = n + 1; k < P.length; k++) { const b = P[k], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < 100) { x.strokeStyle = "#b9977f"; x.globalAlpha = (1 - d / 100) * .4; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.globalAlpha = 1; } }
      });
    }
    requestAnimationFrame(loop);
  })();
})();
document.querySelectorAll(".feat").forEach(c => {   // tilt + spotlight
  c.onmousemove = e => { const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.style.setProperty("--rx", (.5 - py) * 8 + "deg"); c.style.setProperty("--ry", (px - .5) * 8 + "deg"); c.style.setProperty("--mx", px * 100 + "%"); c.style.setProperty("--my", py * 100 + "%"); };
  c.onmouseleave = () => { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); };
});
const io = new IntersectionObserver(es => es.forEach(e => {   // scroll reveal + count-up
  if (!e.isIntersecting) return; const t = e.target; t.classList.add("in"); io.unobserve(t);
  const n = t.querySelector("[data-n]"); if (!n) return; const end = +n.dataset.n, st = performance.now();
  (function f(now) { const p = Math.min((now - st) / 1200, 1); n.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(st);
}), { threshold: .15 });
document.querySelectorAll(".rv").forEach((el, i) => { el.style.transitionDelay = (i % 4) * 70 + "ms"; io.observe(el); });

// ===== Fluid motion everywhere =====
const prev = {};
function flair() {   // count-up stats + staggered table rows
  document.querySelectorAll("#stats .stat b").forEach((b, i) => {
    const to = Number(b.textContent.replace(/[^\d.]/g, "")), from = prev[i] ?? 0, money = b.textContent.startsWith("₹"), st = performance.now(); prev[i] = to;
    (function f(n) { const p = Math.min((n - st) / 700, 1), v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); b.textContent = money ? fmt(v) : v; if (p < 1) requestAnimationFrame(f); })(st);
  });
  document.querySelectorAll("#recent tr").forEach((r, i) => r.style.animationDelay = Math.min(i, 12) * 40 + "ms");
  document.querySelectorAll("#stats .card").forEach((c, i) => c.style.setProperty("--k", i));
}
document.querySelectorAll(".feat,.stat.rv").forEach((c, i) => c.style.setProperty("--k", i));
document.querySelectorAll(".page:not(#home)").forEach(p => p.querySelectorAll(".card,h1,.sub,.actions").forEach((e, i) => e.style.setProperty("--i", Math.min(i, 9))));
document.addEventListener("pointerdown", e => {   // button ripple
  const b = e.target.closest(".btn"); if (!b) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement("span"); s.className = "rip";
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`; b.append(s); setTimeout(() => s.remove(), 600);
});
(function () {   // site-wide drifting network that leans toward the cursor
  const c = $("bg"), x = c.getContext("2d"); let w, h, P = [], mx = -999, my = -999;
  const size = () => { w = c.width = innerWidth; h = c.height = innerHeight; P = Array.from({ length: Math.min(55, w * h / 25000 | 0) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4, r: 1 + Math.random() * 1.8 })); };
  size(); addEventListener("resize", size); addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; });
  (function loop() {
    if (!document.hidden) {
      x.clearRect(0, 0, w, h);
      P.forEach(p => { if (reduce) return; p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h; const dx = mx - p.x, dy = my - p.y, d = Math.hypot(dx, dy); if (d < 170 && d > 1) { p.x += dx / d * .35; p.y += dy / d * .35; } });
      P.forEach((a, n) => {
        x.fillStyle = "rgba(150,120,105,.35)"; x.beginPath(); x.arc(a.x, a.y, a.r, 0, 7); x.fill();
        for (let k = n + 1; k < P.length; k++) { const b = P[k], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < 130) { x.strokeStyle = "rgba(150,120,105," + (1 - d / 130) * .18 + ")"; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); } }
      });
    }
    requestAnimationFrame(loop);
  })();
})();

// ===== Alive boxes: jelly press, sparkle burst, card ripple =====
function burst(x, y) {
  for (let i = 0; i < 10; i++) {
    const d = document.createElement("span"), a = Math.PI * 2 * i / 10 + Math.random() * .5, r = 28 + Math.random() * 34;
    d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;margin:-3px;border-radius:50%;pointer-events:none;z-index:50;background:hsl(${15 + Math.random() * 45},70%,74%)`;
    document.body.append(d);
    d.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r}px) scale(0)`, opacity: 0 }], { duration: 500 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => d.remove();
  }
}
document.addEventListener("pointerdown", e => {
  const t = e.target.closest(".btn,.card,.qcard,.bar,nav a,.badge"); if (!t || reduce) return;
  if (t.matches(".card") && e.target.closest("input,select,textarea,a,table,svg")) return;
  t.animate([{ scale: 1 }, { scale: .9 }, { scale: 1.07 }, { scale: .98 }, { scale: 1 }], { duration: 600, easing: "ease-out" });
  burst(e.clientX, e.clientY);
  if (t.matches(".card:not(.scroll)")) {
    const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement("span"); s.className = "rip";
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`; t.append(s); setTimeout(() => s.remove(), 600);
  }
});
const tiltSel = ".grid .card,.qcard", tiltVars = (c, px, py) => { c.style.setProperty("--rx", (.5 - py) * 10 + "deg"); c.style.setProperty("--ry", (px - .5) * 10 + "deg"); c.style.setProperty("--mx", px * 100 + "%"); c.style.setProperty("--my", py * 100 + "%"); };
document.addEventListener("pointermove", e => { const c = e.target.closest(tiltSel); if (!c) return; const r = c.getBoundingClientRect(); tiltVars(c, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
document.addEventListener("pointerout", e => { const c = e.target.closest(tiltSel); if (c && !c.contains(e.relatedTarget)) tiltVars(c, .5, .5); });

// ===== Accounts, history/undo, export =====
const PROTECTED = ["dashboard", "add", "queue", "search", "sort"];
let user = null, dname = "", server = false, undoStack = [], log = [], mode = "login";
const ukey = () => KEY + ":" + (user || "guest");
function snap(label) {   // remember state so the action can be undone
  undoStack.push({ label, txns: JSON.stringify(txns), q: queue.items.map(t => t.id) }); if (undoStack.length > 20) undoStack.shift();
  log.unshift({ t: new Date().toLocaleTimeString(), m: label }); log.length = Math.min(log.length, 30);
}
function hist() { $("hist").innerHTML = txns.filter(t => t.status === "Success").slice(0, 8).map(t => `<li><b>${esc(t.time || "")}</b>${t.dir === "in" ? "+" + fmt(t.amount) + " received from " + esc(t.sender) : "−" + fmt(t.amount) + " sent to " + esc(t.receiver)}</li>`).join("") || "<li class='sub'>No money has moved yet.</li>"; }
$("undoBtn").onclick = () => {
  const s = undoStack.pop(); if (!s) return toast("Nothing to undo.");
  apply({ txns: JSON.parse(s.txns), q: s.q }); log.unshift({ t: new Date().toLocaleTimeString(), m: "Undid: " + s.label }); render(); toast("Undone: " + s.label);
};
const cell = v => { v = String(v ?? ""); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };   // also blocks CSV formula injection
$("csvBtn").onclick = () => {
  const rows = [["ID", "Sender", "Receiver", "Amount", "Method", "Status", "Time"], ...txns.map(t => [t.id, t.sender, t.receiver, t.amount, t.method, t.status, t.time || ""])];
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" })); a.download = "transactions.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("CSV exported.");
};
$("pdfBtn").onclick = () => {   // opens the print dialog: choose "Save as PDF"
  $("printArea").innerHTML = `<h2>Transactions: ${esc(user)}</h2><table><tr><th>ID</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Method</th><th>Status</th><th>Time</th></tr>` +
    txns.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.sender)}</td><td>${esc(t.receiver)}</td><td class="${t.dir}">${t.dir === "in" ? "+" : "−"}${fmt(t.amount)}</td><td>${esc(t.method)}</td><td>${esc(t.status)}</td><td>${esc(t.time || "")}</td></tr>`).join("") + "</table>";
  print();
};
async function hashPw(p, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]);
  const b = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" }, k, 256);
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function authReq(kind, d) {   // returns { err } or { name }
  try {
    const r = await fetch("/api/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    const j = await r.json(); server = true; return r.ok ? { name: j.name } : { err: j.error || "Something went wrong" };
  } catch (e) { /* no server reachable: browser-only accounts below */ }
  server = false; const U = JSON.parse(localStorage.getItem("dptp_users") || "{}"), k = d.email;
  if (kind === "register") { if (U[k]) return { err: "An account with this email already exists" }; const salt = crypto.randomUUID(); U[k] = { name: d.name, phone: d.phone, salt, hash: await hashPw(d.p, salt) }; localStorage.setItem("dptp_users", JSON.stringify(U)); }
  else { const x = U[k]; if (!x || await hashPw(d.p, x.salt) !== x.hash) return { err: "Invalid email or password" }; d.name = x.name; }
  localStorage.setItem("dptp_session", k); return { name: d.name };
}
function updateAuthUI() {
  $("authBtn").hidden = !!user; $("userBox").hidden = !user; $("uname").textContent = dname; $("uav").textContent = (dname || "U")[0].toUpperCase();
  document.querySelectorAll("#top nav a").forEach(a => a.classList.toggle("locked", !user && PROTECTED.includes(a.dataset.go)));
  online = server; dbState();
}
async function enter(email, name) { user = email; dname = name; await load(); render(); updateAuthUI(); }
function setMode(m) {
  mode = m; $("auth").classList.toggle("isreg", m === "register"); document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === m));
  $("asubmit").textContent = m === "login" ? "Login" : "Create account"; $("atitle").textContent = m === "login" ? "Welcome back" : "Create your account"; $("aerr").textContent = "";
  $("ap").autocomplete = m === "login" ? "current-password" : "new-password";
}
function openAuth(msg) { setMode("login"); $("amsg").textContent = msg || "Log in or create an account."; $("auth").showModal(); $("au").focus(); }
document.querySelectorAll(".tab").forEach(t => t.onclick = () => setMode(t.dataset.tab));
$("afid").oninput = () => {
  clearTimeout($("afid").h); const v = $("afid").value.trim().toLowerCase(); $("afhint").textContent = "Your ID will be yourname@payflow"; if (!/^[a-z0-9._]{3,20}$/.test(v)) return;
  $("afid").h = setTimeout(async () => { try { const r = await fetch("/api/check/" + v), d = await r.json(); $("afhint").textContent = d.free ? "✓ " + v + "@payflow is available" : "✗ already taken"; } catch (e) { /* offline */ } }, 350);
};
$("authBtn").onclick = () => openAuth();
$("acancel").onclick = () => $("auth").close();
$("auth").onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT") $("asubmit").click(); };
$("asubmit").onclick = async () => {
  const email = $("au").value.trim().toLowerCase(), p = $("ap").value, name = $("an").value.trim(), phone = $("aph").value.replace(/[\s-]/g, ""), fid = $("afid").value.trim().toLowerCase().replace(/@payflow$/, "");
  let err = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Enter a valid email address" : p.length < 8 ? "Password must be at least 8 characters" : "";
  if (!err && mode === "register") err = !/^[\p{L} .'-]{2,40}$/u.test(name) ? "Enter your full name (letters only)" : !/^\+?[0-9]{7,15}$/.test(phone) ? "Enter a valid phone number (7–15 digits)" : !/^[a-z0-9._]{3,20}$/.test(fid) ? "PayFlow ID: 3–20 lowercase letters, numbers, . or _" : "";
  if (err) return $("aerr").textContent = err;
  $("asubmit").disabled = true; const r = await authReq(mode, mode === "login" ? { email, p } : { name, email, phone, fid, p }); $("asubmit").disabled = false;
  if (r.err) return $("aerr").textContent = r.err;
  $("auth").close(); $("au").value = $("ap").value = $("an").value = $("aph").value = $("afid").value = ""; await enter(email, r.name); go("dashboard"); toast("Welcome, " + r.name + "!");
};
$("logoutBtn").onclick = async () => {
  try { if (server) await fetch("/api/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  localStorage.removeItem("dptp_session"); user = null; dname = ""; me = { name: "", fid: "", balance: 0 }; lastSig = ""; txns = []; queue = new Queue(); sortView = []; undoStack = []; log = [];
  render(); updateAuthUI(); go("home"); toast("Logged out.");
};
(async () => {   // restore an existing session, then show the homepage
  try { const r = await fetch("/api/me"); server = true; if (r.ok) { const j = await r.json(); user = j.user; dname = j.name; } } catch (e) { server = false; }
  if (!user && !server) { const n = localStorage.getItem("dptp_session"), x = JSON.parse(localStorage.getItem("dptp_users") || "{}")[n]; if (x) { user = n; dname = x.name; } }
  if (user) await load();
  render(); updateAuthUI(); go("home");
})();

// PayFlow server: accounts + wallets + payments. Run: npm install && npm start -> http://localhost:3000
// Render-ready: honours PORT, DB_PATH (point at a persistent disk) and NODE_ENV=production.
const express = require("express"), helmet = require("helmet"), rateLimit = require("express-rate-limit"), path = require("path"), crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");   // built into Node 22.5+
const PROD = process.env.NODE_ENV === "production";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "payments.db");
require("fs").mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS wallets(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, fid TEXT UNIQUE NOT NULL,
  balance INTEGER NOT NULL DEFAULT 200000 CHECK(balance>=0), hash TEXT NOT NULL, salt TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
  status TEXT NOT NULL, created TEXT NOT NULL, done TEXT)`);   // money is stored in paise (whole numbers): 200000 = Rs 2000.00
db.exec("DELETE FROM sessions WHERE exp<" + Date.now() + " OR uid NOT IN (SELECT id FROM wallets)");

const emailOk = e => typeof e === "string" && e.length <= 60 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const passOk = p => typeof p === "string" && p.length >= 8 && p.length <= 64;
const fidOf = s => typeof s === "string" ? s.trim().toLowerCase().replace(/@payflow$/, "") : "";
const fidOk = f => /^[a-z0-9._]{3,20}$/.test(f);
const regOk = b => b && typeof b.name === "string" && /^[\p{L} .'-]{2,40}$/u.test(b.name.trim()) && emailOk(b.email) && typeof b.phone === "string" && /^\+?[0-9]{7,15}$/.test(b.phone) && fidOk(fidOf(b.fid)) && passOk(b.p);

// --- Auth helpers: scrypt hashing, random session tokens, HttpOnly + SameSite=Strict cookie ---
const hashPw = (p, salt) => crypto.scryptSync(p, salt, 64).toString("hex");
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = req => (/(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || "") || [])[1];
function startSession(res, uid) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(token, uid, Date.now() + 864e5);
  res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${PROD ? "; Secure" : ""}`);
}
const who = req => { const t = cookie(req); if (!t) return null; const s = db.prepare("SELECT s.uid, w.name, w.email, s.exp FROM sessions s JOIN wallets w ON w.id=s.uid WHERE token=?").get(t); return s && s.exp > Date.now() ? s : null; };
const need = (req, res, next) => { const s = who(req); if (!s) return res.status(401).json({ error: "Login required" }); req.uid = s.uid; next(); };

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);   // Render sits behind one proxy: needed for correct client IPs (rate limiting) and HTTPS detection
app.get("/healthz", (req, res) => res.type("text").send("ok"));
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "object-src": ["'none'"], "frame-ancestors": ["'none'"] } } }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 240, message: { error: "Too many requests" } }), express.json({ limit: "20kb" }));
const authLimit = rateLimit({ windowMs: 60000, limit: 10, message: { error: "Too many attempts. Try again in a minute." } });
const moneyLimit = rateLimit({ windowMs: 60000, limit: 40, message: { error: "Slow down a little." } });

// --- Accounts ---
app.get("/api/check/:fid", (req, res) => { const f = fidOf(req.params.fid); res.json({ free: fidOk(f) && !db.prepare("SELECT 1 FROM wallets WHERE fid=?").get(f) }); });
app.post("/api/register", authLimit, (req, res) => {
  const b = req.body; if (!regOk(b)) return res.status(400).json({ error: "Please check your name, email, phone, PayFlow ID and password" });
  const salt = crypto.randomBytes(16).toString("hex"), email = b.email.toLowerCase();
  try { const r = db.prepare("INSERT INTO wallets(name,email,phone,fid,hash,salt) VALUES(?,?,?,?,?,?)").run(b.name.trim(), email, b.phone, fidOf(b.fid), hashPw(b.p, salt), salt); startSession(res, r.lastInsertRowid); res.json({ user: email, name: b.name.trim() }); }
  catch (e) { res.status(409).json({ error: String(e.message).includes("wallets.fid") ? "That PayFlow ID is already taken" : "An account with this email already exists" }); }
});
app.post("/api/login", authLimit, (req, res) => {
  const b = req.body; if (!b || !emailOk(b.email) || !passOk(b.p)) return res.status(400).json({ error: "Invalid email or password" });
  const u = db.prepare("SELECT * FROM wallets WHERE email=?").get(b.email.toLowerCase());
  if (u && u.locked > Date.now()) return res.status(423).json({ error: "Account locked for 15 minutes" });
  if (!u || !same(hashPw(b.p, u.salt), u.hash)) {   // lock after 5 failed attempts
    if (u) { const f = u.fails + 1; db.prepare("UPDATE wallets SET fails=?, locked=? WHERE id=?").run(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 15 * 60000 : 0, u.id); }
    return res.status(401).json({ error: "Invalid email or password" });
  }
  db.prepare("UPDATE wallets SET fails=0, locked=0 WHERE id=?").run(u.id);
  startSession(res, u.id); res.json({ user: u.email, name: u.name });
});
app.post("/api/logout", (req, res) => { const t = cookie(req); if (t) db.prepare("DELETE FROM sessions WHERE token=?").run(t); res.setHeader("Set-Cookie", `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PROD ? "; Secure" : ""}`); res.sendStatus(204); });
app.get("/api/me", (req, res) => { const s = who(req); s ? res.json({ user: s.email, name: s.name }) : res.status(401).json({ error: "Not logged in" }); });

// --- Wallet: READ balance + history (you only ever see your own rows; the receiver sees a payment once it is processed) ---
const TXN = n => "TXN-" + String(n).padStart(6, "0"), now = () => new Date().toLocaleString("en-IN");
app.get("/api/wallet", need, (req, res) => {
  const me = db.prepare("SELECT name, fid, balance FROM wallets WHERE id=?").get(req.uid);
  const rows = db.prepare(`SELECT p.id, p.from_id, p.amount, p.status, p.created, p.done, f.fid ffid, t.fid tfid FROM payments p JOIN wallets f ON f.id=p.from_id JOIN wallets t ON t.id=p.to_id
    WHERE p.from_id=? OR (p.to_id=? AND p.status='Success') ORDER BY p.id DESC`).all(req.uid, req.uid);
  const txns = rows.map(p => { const out = p.from_id === req.uid; return { id: TXN(p.id), dir: out ? "out" : "in", sender: out ? "You" : p.ffid + "@payflow", receiver: out ? p.tfid + "@payflow" : "You", amount: p.amount / 100, method: "PayFlow", status: p.status, time: p.done || p.created }; });
  res.json({ me: { name: me.name, fid: me.fid, balance: me.balance / 100 }, txns, pending: rows.filter(p => p.from_id === req.uid && p.status === "Pending").reverse().map(p => TXN(p.id)) });
});

// --- CREATE a payment (goes into the sender's FIFO queue as Pending; no money moves yet) ---
app.post("/api/send", need, moneyLimit, (req, res) => {
  const { fid, name, amount } = req.body || {}, paise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(paise) || paise < 100 || paise > 10000000 || Math.abs(Number(amount) * 100 - paise) > 1e-6) return res.status(400).json({ error: "Amount must be between ₹1 and ₹100000 (max 2 decimals)" });
  const to = db.prepare("SELECT id, name FROM wallets WHERE fid=?").get(fidOf(fid));
  if (!to || typeof name !== "string" || to.name.trim().toLowerCase() !== name.trim().toLowerCase()) return res.status(404).json({ error: "Receiver not found. Check the name and PayFlow ID." });
  if (to.id === req.uid) return res.status(400).json({ error: "You can't send money to yourself" });
  if (db.prepare("SELECT COUNT(*) c FROM payments WHERE from_id=? AND status='Pending'").get(req.uid).c >= 20) return res.status(400).json({ error: "Too many pending payments. Process or cancel some first." });
  const r = db.prepare("INSERT INTO payments(from_id,to_id,amount,status,created) VALUES(?,?,?,'Pending',?)").run(req.uid, to.id, paise, now());
  res.json({ txn: TXN(r.lastInsertRowid) });
});

// --- UPDATE: process the OLDEST pending payment (dequeue). Debit + credit + status happen together or not at all. ---
app.post("/api/process", need, moneyLimit, (req, res) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const p = db.prepare("SELECT * FROM payments WHERE from_id=? AND status='Pending' ORDER BY id LIMIT 1").get(req.uid);
    if (!p) { db.exec("ROLLBACK"); return res.status(404).json({ error: "No pending payments in your queue" }); }
    const debit = db.prepare("UPDATE wallets SET balance=balance-? WHERE id=? AND balance>=?").run(p.amount, req.uid, p.amount);
    if (debit.changes !== 1) {   // not enough money: mark failed, move nothing
      db.prepare("UPDATE payments SET status='Failed', done=? WHERE id=?").run(now(), p.id); db.exec("COMMIT");
      return res.json({ txn: TXN(p.id), status: "Failed", balance: db.prepare("SELECT balance FROM wallets WHERE id=?").get(req.uid).balance / 100 });
    }
    db.prepare("UPDATE wallets SET balance=balance+? WHERE id=?").run(p.amount, p.to_id);
    db.prepare("UPDATE payments SET status='Success', done=? WHERE id=?").run(now(), p.id); db.exec("COMMIT");
    res.json({ txn: TXN(p.id), status: "Success", balance: db.prepare("SELECT balance FROM wallets WHERE id=?").get(req.uid).balance / 100 });
  } catch (e) { try { db.exec("ROLLBACK"); } catch (x) { /* already closed */ } res.status(500).json({ error: "Could not process payment" }); }
});

// --- DELETE (cancel) a payment that is still Pending. Processed payments stay in history forever. ---
app.post("/api/cancel/:id", need, moneyLimit, (req, res) => {
  const n = Number(String(req.params.id).replace(/\D/g, ""));
  const r = db.prepare("UPDATE payments SET status='Cancelled', done=? WHERE id=? AND from_id=? AND status='Pending'").run(now(), n, req.uid);
  r.changes === 1 ? res.json({ ok: true }) : res.status(404).json({ error: "Nothing to cancel" });
});

["index.html", "style.css", "script.js"].forEach(f => app.get(f === "index.html" ? "/" : "/" + f, (req, res) => res.sendFile(path.join(__dirname, f))));
app.use((err, req, res, next) => res.status(400).json({ error: "Bad request" }));
const PORT = Number(process.env.PORT) || 3000, HOST = process.env.HOST || (PROD || process.env.PORT ? "0.0.0.0" : "127.0.0.1");
setInterval(() => { try { db.prepare("DELETE FROM sessions WHERE exp<?").run(Date.now()); } catch (e) { /* ignore */ } }, 36e5).unref();
const server = app.listen(PORT, HOST, () => console.log(`Running on ${HOST}:${PORT}`));
const stop = () => server.close(() => { try { db.close(); } catch (e) { /* ignore */ } process.exit(0); });   // clean shutdown on Render redeploys
process.on("SIGTERM", stop); process.on("SIGINT", stop);

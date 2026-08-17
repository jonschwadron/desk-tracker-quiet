(function () {
  "use strict";

  const TZ = "America/New_York";
  const DESK_MS = 3000;
  const SPOT_MS = 30000;
  const GOLD_URL = "https://api.gold-api.com/price/XAU";

  const CLOCK = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const FEED_T = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const $ = (id) => document.getElementById(id);

  const state = {
    events: [],
    book: null,
    livePrice: null,
    liveAt: null,
    liveOk: false,
    lastSpot: null,
  };

  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function payload(e) { return (e && e.payload) || {}; }
  function px(n, d) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2,
    });
  }
  function ageLabel(ms) {
    if (ms == null || !isFinite(ms)) return "";
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return "now";
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h";
  }
  function fvgFrom(p) {
    if (!p) return null;
    const nest = p.fvg && typeof p.fvg === "object" ? p.fvg : null;
    const lo = p.gap_low ?? p.fvg_low ?? (nest && (nest.fvg_low ?? nest.gap_low ?? nest.low));
    const hi = p.gap_high ?? p.fvg_high ?? (nest && (nest.fvg_high ?? nest.gap_high ?? nest.high));
    if (lo == null || hi == null) return null;
    return {
      low: Number(lo),
      high: Number(hi),
      late: !!(p.late_chase || (nest && nest.late_chase)),
      role: (nest && nest.role) || p.role || "",
      unused: (p.fill_state === "unused") || (nest && nest.unused) || p.unused,
    };
  }

  function tickClock() {
    $("clock").textContent = CLOCK.format(new Date()) + " ET";
    $("clock").dateTime = new Date().toISOString();
    paintSpotMeta();
  }

  function latest(pred) {
    for (let i = state.events.length - 1; i >= 0; i--) {
      if (pred(state.events[i], payload(state.events[i]))) return state.events[i];
    }
    return null;
  }

  function reasonText() {
    const ev = latest((e, p) => p.skip_reason || p.reason || (e.action || "").toLowerCase() === "card");
    const p = payload(ev);
    return p.skip_reason || p.reason || p.refuse || "price above unused M30 box; no 50% return";
  }

  function heroStatus() {
    const ev = latest((e, p) => p.status || p.card);
    const p = payload(ev);
    return String(p.status || p.card || "WAIT").toUpperCase();
  }

  function m30Sentence() {
    const ev = latest((e, p) => {
      const b = p.htf_box || p.box;
      return (e.tf === "M30" && (p.distal != null || (b && b.distal != null)));
    });
    const p = payload(ev);
    const b = p.htf_box || p.box || p;
    const lo = b.distal, hi = b.proximal;
    if (lo == null || hi == null) {
      return "Unused M30 4373–4392. Price is above. Do not chase.";
    }
    return "Unused M30 " + Math.round(lo) + "–" + Math.round(hi) + ". Price is above. Do not chase.";
  }

  function fvgSentence() {
    let f = null;
    for (let i = state.events.length - 1; i >= 0; i--) {
      f = fvgFrom(payload(state.events[i]));
      if (f) break;
    }
    if (!f) return "D1 FVG 4106–4224 is a profit area. Late chase, not a buy.";
    return "D1 FVG " + Math.round(f.low) + "–" + Math.round(f.high) +
      " is a profit area. Late chase, not a buy.";
  }

  function slSentence() {
    const b = state.book || {};
    const t = (b.open && b.open[0]) || {};
    const runner = latest((e) => (e.action || "").toLowerCase() === "runner");
    const sl = t.sl ?? payload(runner).sl ?? 4050;
    return "SL " + Math.round(Number(sl)) + ". Do not move.";
  }

  function oneLine(e) {
    const p = payload(e);
    const a = (e.action || "").toLowerCase();
    if (p.reason) return p.reason;
    if (p.skip_reason) return p.skip_reason;
    if (p.note) return p.note;
    if (p.refuse) return String(p.refuse).replace(/_/g, " ");
    if (a === "runner") return "ticket " + (p.ticket || "") + " · SL " + (p.sl ?? "");
    if (a === "send") return "FVG to " + (p.to || "MACRO");
    return a || "event";
  }

  function renderFeed() {
    const rows = [...state.events].reverse().slice(0, 5);
    $("feed").innerHTML = rows.map((e) => {
      const d = parseTs(e.ts);
      const t = d ? FEED_T.format(d) : "—";
      const who = (e.agent || "").toUpperCase();
      return "<li>" + t + "  " + who + "  " + oneLine(e) + "</li>";
    }).join("");
  }

  function paintSpotMeta() {
    const el = $("spot-meta");
    if (!el) return;
    if (state.liveOk && state.liveAt) {
      el.textContent = "LIVE · " + ageLabel(Date.now() - state.liveAt) + " · indicative XAU mid";
    } else {
      el.textContent = "STALE · book bid · not live";
    }
  }

  function setSpot(n, live) {
    const el = $("spot");
    const txt = px(n);
    if (txt !== state.lastSpot) {
      el.textContent = txt;
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
      state.lastSpot = txt;
    } else {
      el.textContent = txt;
    }
    state.liveOk = !!live;
    paintSpotMeta();
  }

  function renderDesk() {
    $("hero").textContent = heroStatus();
    $("reason").textContent = reasonText();

    const b = state.book || {};
    const t = (b.open && b.open[0]) || {};
    const runner = latest((e) => (e.action || "").toLowerCase() === "runner");
    const rp = payload(runner);

    const fl = b.floating_pl;
    const flEl = $("float");
    if (fl == null) {
      flEl.textContent = "—";
      flEl.className = "num";
    } else {
      flEl.textContent = (fl >= 0 ? "+" : "") + px(fl);
      flEl.className = "num " + (fl >= 0 ? "up" : "dn");
    }

    $("ticket").textContent = t.ticket || rp.ticket || "102034139";
    const risk = b.risk_usd_new_fills ?? rp.risk_usd_new_fills ?? 160.68;
    $("risk").textContent = "$" + px(risk);

    if (!state.liveOk) {
      const fallback = b.bid ?? t.statement_mark ?? rp.spot ?? 4394.72;
      setSpot(fallback, false);
    }

    $("m30").textContent = m30Sentence();
    $("fvg").textContent = fvgSentence();
    $("sl").textContent = slSentence();
    renderFeed();
  }

  async function pollDesk() {
    try {
      const [ev, bk] = await Promise.all([
        fetch("events.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()),
        fetch("book.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (Array.isArray(ev)) state.events = ev;
      if (bk && typeof bk === "object") state.book = bk;
      renderDesk();
    } catch (_) { /* keep last paint */ }
  }

  async function pollSpot() {
    try {
      const r = await fetch(GOLD_URL, { cache: "no-store" });
      if (!r.ok) throw new Error("spot");
      const j = await r.json();
      const price = Number(j.price);
      if (!isFinite(price)) throw new Error("price");
      state.livePrice = price;
      state.liveAt = j.updatedAt ? Date.parse(j.updatedAt) || Date.now() : Date.now();
      setSpot(price, true);
    } catch (_) {
      state.liveOk = false;
      const b = state.book || {};
      const t = (b.open && b.open[0]) || {};
      setSpot(b.bid ?? t.statement_mark ?? 4394.72, false);
    }
  }

  tickClock();
  setInterval(tickClock, 1000);
  pollDesk();
  pollSpot();
  setInterval(pollDesk, DESK_MS);
  setInterval(pollSpot, SPOT_MS);
})();

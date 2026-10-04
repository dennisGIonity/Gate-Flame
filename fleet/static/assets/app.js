/* Gate^Flame Fleet — operator console.
 *
 * Rules kept here, from CLAUDE.md:
 *  - Nothing is invented. A value the API did not return is "—" and, where it
 *    matters, says why. Never a zero standing in for "unknown".
 *  - "Cannot reach the fleet server" and "reached it, nothing there" never
 *    share a screen.
 *  - The support findings are rendered, not written: every one comes from the
 *    server, traceable to a field the box reported.
 *  - Strict CSP: no inline script, no inline style, no event-handler attributes.
 *    Every URL is RELATIVE so the page works under any path prefix.
 */
(() => {
'use strict';

const DASH = '—';
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { view: 'fleet', nodeId: null, q: '', status: '', tag: '', billing: '', sort: 'status', window: '24h' };
let summary = null, nodes = [], detail = null, history = null, refreshTimer = null, searchTimer = null;

/* ------------------------------------------------------------------ format */
function fmtDur(s) {
  s = num(s); if (s == null) return DASH;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtAgo(s) {
  s = num(s); if (s == null) return DASH;
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago`
    : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}
function fmtDate(t) {
  t = num(t); if (t == null) return DASH;
  return new Date(t * 1000).toLocaleString('en-ZA', { hour12: false, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(t) { return new Date(t * 1000).toLocaleString('en-ZA', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fixed(v, d) { v = num(v); return v == null ? DASH : v.toFixed(d); }
function toneOf(v, warn, bad) { v = num(v); if (v == null) return ''; return v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok'; }
function memPct(h) { const u = num(h.memUsedMB), t = num(h.memTotalMB); return (u != null && t) ? 100 * u / t : null; }

/* --------------------------------------------------------------------- api */
async function api(path, opts) {
  const o = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts || {});
  o.headers = Object.assign({ 'X-Requested-With': 'gateflame-fleet', 'Accept': 'application/json' }, o.headers || {});
  let res;
  try { res = await fetch(path, o); }
  catch (e) { const err = new Error('unreachable'); err.kind = 'network'; throw err; }
  if (res.status === 401) { location.href = 'login?e=expired'; throw Object.assign(new Error('signed out'), { kind: 'auth' }); }
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); if (j && j.detail) msg += ' · ' + j.detail; } catch (_) { /* not json */ }
    throw Object.assign(new Error(msg), { kind: 'http', status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

function setLive(ok, text) {
  const el = $('live'); el.classList.toggle('ok', ok); el.classList.toggle('bad', !ok);
  $('liveText').textContent = text;
}
function now() { return new Date().toLocaleTimeString('en-ZA', { hour12: false }); }

/* ------------------------------------------------------------------ charts
 * Inline SVG, no library. A gap in the data is a BREAK in the line, never
 * interpolated across: a missing sample and a real value must not look alike. */
function chart(points, key, cls, label, unit) {
  const pts = points.filter((p) => num(p[key]) != null);
  if (pts.length < 2) {
    return `<div class="chart"><div class="lbl"><span>${esc(label)}</span><b>${pts.length ? fixed(pts[0][key], 1) + unit : DASH}</b></div>
      <div class="notice">${pts.length ? 'Only one reading in this window — a line needs two.' : 'No readings in this window.'}</div></div>`;
  }
  const W = 600, H = 96, pad = 6;
  const vals = pts.map((p) => p[key]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  // Break the line where the spacing jumps well past the typical step.
  const steps = []; for (let i = 1; i < points.length; i++) steps.push(points[i].t - points[i - 1].t);
  steps.sort((a, b) => a - b);
  const typical = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
  const maxGap = typical ? typical * 3.5 : Infinity;
  const segs = []; let cur = []; let prevT = null;
  for (const p of points) {
    const v = num(p[key]);
    if (v == null || (prevT != null && p.t - prevT > maxGap)) { if (cur.length) segs.push(cur); cur = []; }
    if (v != null) cur.push([x(p.t), y(v)]);
    prevT = p.t;
  }
  if (cur.length) segs.push(cur);
  const line = segs.map((s) => 'M' + s.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L')).join(' ');
  const area = segs.filter((s) => s.length > 1).map((s) =>
    `M${s[0][0].toFixed(1)} ${H} L` + s.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ` L${s[s.length - 1][0].toFixed(1)} ${H} Z`).join(' ');
  const last = vals[vals.length - 1];
  const grid = [0.25, 0.5, 0.75].map((f) => `<line class="grid" x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('');
  return `<div class="chart"><div class="lbl"><span>${esc(label)}</span><b>${last.toFixed(1)}${unit}</b></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)} trend">
      ${grid}<path class="area ${cls}" d="${area}"/><path class="line ${cls}" d="${line}"/></svg>
    <div class="meta">${fmtTime(t0)} → ${fmtTime(t1)} · min ${Math.min(...vals).toFixed(1)} · max ${Math.max(...vals).toFixed(1)}</div></div>`;
}

function meter(label, pct, text, warn, bad) {
  const p = num(pct);
  return `<div class="meter"><div class="row"><span>${esc(label)}</span><span>${esc(text)}</span></div>
    <div class="bar ${p == null ? 'unknown' : ''}">${p == null ? '' : `<i class="${toneOf(p, warn, bad)}" data-w="${Math.max(0, Math.min(100, p)).toFixed(1)}"></i>`}</div></div>`;
}
function applyWidths(root) { root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; }); }

/* ------------------------------------------------------------------ routing */
function readHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^node\/([^?]+)(?:\?w=(24h|7d|30d|90d))?$/);
  if (m) { state.view = 'node'; state.nodeId = decodeURIComponent(m[1]); if (m[2]) state.window = m[2]; }
  else { state.view = 'fleet'; state.nodeId = null; }
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function route() {
  readHash();
  clearInterval(refreshTimer);
  if (state.view === 'node') { showNode(); }
  else { loadFleet(); refreshTimer = setInterval(() => { if (!document.hidden) loadFleet(true); }, 15000); }
}

/* -------------------------------------------------------------- fleet view */
function qs() {
  const p = new URLSearchParams();
  ['q', 'status', 'tag', 'billing'].forEach((k) => { if (state[k]) p.set(k, state[k]); });
  p.set('sort', state.sort);
  return p.toString();
}

async function loadFleet(quiet) {
  try {
    [summary, nodes] = await Promise.all([api('api/v1/fleet/summary'), api('api/v1/nodes?' + qs())]);
  } catch (e) {
    if (e.kind === 'auth') return;
    setLive(false, e.kind === 'network' ? 'server unreachable' : 'error');
    if (!quiet || !summary) {
      $('view').innerHTML = e.kind === 'network'
        ? `<div class="state fault"><h2>Cannot reach the fleet server</h2>
           <p>This browser could not connect to it at all, so nothing here would describe the fleet as it is now —
           and nothing is shown. Check that the fleet service is running (tools\\START-IONITY-SERVER.cmd on the
           Ionity offline server).</p></div>`
        : `<div class="state fault"><h2>The fleet server answered with an error</h2><p>${esc(e.message)}</p></div>`;
    }
    return;
  }
  setLive(true, 'updated ' + now());
  renderFleet();
}

function tile(key, label, value, extra, cls, filter) {
  const on = filter !== undefined && state.status === filter;
  const tag = filter !== undefined ? 'button' : 'div';
  const act = filter !== undefined ? ` type="button" data-action="status" data-v="${esc(filter)}" aria-pressed="${on}"` : '';
  return `<${tag} class="tile ${cls || ''} ${filter === undefined ? 'static' : ''} ${on ? 'on' : ''}"${act}>
    <div class="k">${esc(label)}</div><div class="v">${value}${extra ? `<small>${extra}</small>` : ''}</div></${tag}>`;
}

function renderFleet() {
  const s = summary;
  $('sub').textContent = `${s.total} box${s.total === 1 ? '' : 'es'} registered`;
  const focused = document.activeElement && document.activeElement.id === 'q';
  const caret = focused ? document.activeElement.selectionStart : null;

  const hot = num(s.hottestC);
  const tiles = `<div class="tiles">
    ${tile('all', 'Fleet', s.total, '', '', '')}
    ${tile('on', 'Online', s.online, '', s.online ? 'ok' : '', 'online')}
    ${tile('st', 'Stale', s.stale, '', s.stale ? 'warn' : '', 'stale')}
    ${tile('off', 'Offline', s.offline, '', s.offline ? 'bad' : '', 'offline')}
    ${tile('dns', 'DNS filter up', s.filtering, 'of ' + s.total, s.total ? (s.filtering === s.total ? 'ok' : 'warn') : '')}
    ${tile('hot', 'Hottest box', hot == null ? DASH : hot.toFixed(1), hot == null ? 'no temperature reported' : '°C',
      hot == null ? '' : toneOf(hot, 70, 80))}
  </div>`;

  const tr = (s.trend || []).map((p) => ({ t: p.hour * 3600, cpu: p.cpu, temp: p.temp, mem: p.mem }));
  const trend = tr.length > 1 ? `<section class="card">
      <div class="card-h"><div><h2>Fleet average · last 7 days</h2><div class="sub">Hourly averages across every box that reported in that hour.</div></div></div>
      <div class="grid-3">${chart(tr, 'cpu', 'c-cpu', 'Processor', '%')}${chart(tr, 'temp', 'c-temp', 'Temperature', '°C')}${chart(tr, 'mem', 'c-mem', 'Memory', '%')}</div>
    </section>` : '';

  const chips = (obj, kind, skip) => Object.entries(obj || {}).filter(([k]) => k !== skip).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<button type="button" class="chip ${state[kind] === k ? 'on' : ''}" data-action="${kind}" data-v="${esc(k)}">${esc(k)}<span class="n">${n}</span></button>`).join('');
  const anyFilter = state.q || state.status || state.tag || state.billing;
  const sortBtn = (k, label) => `<button type="button" class="${state.sort === k ? 'on' : ''}" data-action="sort" data-v="${k}">${label}</button>`;

  const controls = `<div class="controls">
      <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Search box id, name, customer ref or tag" value="${esc(state.q)}" aria-label="Search"></label>
      <select id="sort" aria-label="Sort">
        <option value="status" ${state.sort === 'status' ? 'selected' : ''}>Needs attention first</option>
        <option value="name" ${state.sort === 'name' ? 'selected' : ''}>Name</option>
        <option value="temp" ${state.sort === 'temp' ? 'selected' : ''}>Hottest</option>
        <option value="seen" ${state.sort === 'seen' ? 'selected' : ''}>Most recently seen</option>
      </select>
      ${anyFilter ? '<button type="button" class="btn sm ghost" data-action="clear">Clear filters</button>' : ''}
    </div>
    <div class="controls chips">${chips(s.tags, 'tag')}${chips(s.billing, 'billing', 'unknown')}</div>`;

  let body;
  if (!s.total) {
    body = `<div class="empty"><b>No box has reported to this server yet.</b><br>
      A box appears the moment it posts its first check-in. Point a box's GATEFLAME_FEED_URL at this server and set GATEFLAME_FEED_ENABLED=true.</div>`;
  } else if (!nodes.length) {
    body = `<div class="empty">No box matches these filters. <button type="button" class="btn sm ghost" data-action="clear">Clear filters</button></div>`;
  } else {
    body = `<div class="tablewrap"><table><thead><tr>
        <th>Status</th><th>${sortBtn('name', 'Box')}</th><th class="hide-md">Billing</th><th>${sortBtn('seen', 'Last seen')}</th>
        <th class="hide-sm">Uptime</th><th>CPU</th><th class="hide-sm">Memory</th><th>${sortBtn('temp', 'Temp')}</th>
        <th class="hide-md">DNS filter</th><th class="hide-md">Modules</th><th class="hide-md">Agent</th>
      </tr></thead><tbody>${nodes.map(row).join('')}</tbody></table></div>`;
  }

  $('view').innerHTML = tiles + trend + controls + `<section class="card tablecard">${body}</section>`;
  if (focused) { const q = $('q'); q.focus(); if (caret != null) q.setSelectionRange(caret, caret); }
}

function row(n) {
  const h = n.host || {}, mp = memPct(h), cpu = num(h.cpuPercent), t = num(h.tempC);
  const mods = n.modules || [];
  return `<tr data-action="node" data-v="${esc(n.nodeId)}" tabindex="0">
    <td><span class="st ${esc(n.status)}">${esc(n.status)}</span></td>
    <td><div class="nname">${esc(n.label || n.nodeId)}</div>${n.label ? `<div class="nid">${esc(n.nodeId)}</div>` : ''}
      ${(n.tags || []).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</td>
    <td class="hide-md"><span class="bill ${esc(n.billingState)}">${esc(n.billingState)}</span></td>
    <td class="num">${fmtAgo(n.lastSeenAgoSeconds)}</td>
    <td class="num hide-sm">${fmtDur(n.uptimeSeconds)}</td>
    <td class="num">${cpu == null ? DASH : cpu.toFixed(0) + '%'}</td>
    <td class="num hide-sm">${mp == null ? DASH : mp.toFixed(0) + '%'}</td>
    <td class="num ${t == null ? '' : 't-' + toneOf(t, 70, 80)}">${t == null ? DASH : t.toFixed(1) + '°'}</td>
    <td class="hide-md"><span class="st ${n.piholeReachable ? 'ok' : 'bad'}">${n.piholeReachable ? 'up' : 'down'}</span></td>
    <td class="num hide-md">${mods.length ? `${n.modulesRunning}/${mods.length}` : DASH}</td>
    <td class="mono hide-md">${esc(n.agentVersion || DASH)}</td>
  </tr>`;
}

/* -------------------------------------------------------------- node view */
async function showNode(keepScroll) {
  const id = state.nodeId;
  if (!keepScroll) $('view').innerHTML = '<div class="skeleton"></div>';
  try {
    [detail, history] = await Promise.all([
      api('api/v1/nodes/' + encodeURIComponent(id)),
      api('api/v1/nodes/' + encodeURIComponent(id) + '/history?window=' + state.window),
    ]);
  } catch (e) {
    if (e.kind === 'auth') return;
    setLive(e.kind !== 'network', e.kind === 'network' ? 'server unreachable' : 'error');
    $('view').innerHTML = `<button class="back" type="button" data-action="home">← All boxes</button>` + (e.status === 404
      ? `<div class="state"><h2>This server has no box called ${esc(id)}</h2><p>The server answered; it has never received a check-in from that id.</p></div>`
      : e.kind === 'network'
        ? `<div class="state fault"><h2>Cannot reach the fleet server</h2><p>Nothing was loaded for ${esc(id)}.</p></div>`
        : `<div class="state fault"><h2>Could not load that box</h2><p>${esc(e.message)}</p></div>`);
    return;
  }
  setLive(true, 'updated ' + now());
  renderNode();
}

function renderNode() {
  const n = detail, h = n.host || {}, c = n.counters || {}, mp = memPct(h);
  $('sub').textContent = n.label || n.nodeId;
  const cpu = num(h.cpuPercent), temp = num(h.tempC), disk = num(h.diskUsedPercent);

  const gaps = (n.modules || []).filter((m) => m.gap).map((m) =>
    `<div class="gap"><b>${esc(String(m.id || '').replace('module_', ''))}</b>${esc(m.gap)}</div>`).join('');
  const mods = (n.modules || []).map((m) => {
    // A module carrying a gap never renders as green "running" (kiosk rule).
    const eff = (m.gap && m.status === 'running') ? 'degraded' : m.status;
    return `<span class="mod ${esc(eff)}" title="${esc(m.status)}">${esc(String(m.id || '').replace('module_', ''))} · ${esc(eff)}</span>`;
  }).join('');

  const findings = (n.findings || []).map((f) => `<div class="find ${esc(f.severity)}">
      <h4><span class="st ${f.severity === 'critical' ? 'bad' : 'warn'}">${esc(f.severity)}</span>${esc(f.title)}</h4>
      <div class="row"><b>What the customer sees</b>${esc(f.customer)}</div>
      <div class="row"><b>What to check</b>${esc(f.check)}</div>
      <div class="ev">reported as ${esc(f.evidence || DASH)}</div></div>`).join('');

  const sh = n.shield;
  let shieldBody;
  if (!n.shieldReported) shieldBody = '<div class="notice">This box runs an agent that predates Shield reporting. Not a fault — it has nothing to say here until it is updated.</div>';
  else if (sh === null) shieldBody = '<div class="notice">The box tried to read its Shield state and could not. That is different from Shield being unconfigured, and worth a look.</div>';
  else if (!sh.configured) shieldBody = '<div class="notice">Nobody in this household has put a device on a region yet. Shield is installed and idle.</div>';
  else shieldBody = (sh.devices || []).map((d) => `<div class="dev"><div><div class="nm">${esc(d.label || d.mac)}</div>
      <div class="mac">${esc(d.mac)}${d.provider ? ' · ' + esc(d.provider) : ''}</div></div>
      <span class="rg ${d.enabled ? 'on' : ''}">${d.region ? esc(d.region) : 'no region'}${d.enabled ? '' : ' · off'}</span></div>`).join('');

  const pts = (history && history.points) || [];
  const winBtns = ['24h', '7d', '30d', '90d'].map((w) =>
    `<button type="button" class="chip ${state.window === w ? 'on' : ''}" data-action="window" data-v="${w}">${w}</button>`).join('');
  const charts = pts.length
    ? `<div class="grid-2">${chart(pts, 'cpu', 'c-cpu', 'Processor', '%')}${chart(pts, 'temp', 'c-temp', 'Temperature', '°C')}
        ${chart(pts, 'mem', 'c-mem', 'Memory', '%')}${chart(pts, 'disk', 'c-disk', 'Storage', '%')}</div>`
    : '<div class="notice">No history in this window. The graph fills in as the box reports; nothing is drawn from a guess.</div>';

  const errs = num(c.errors24h), rst = num(c.restarts24h);
  $('view').innerHTML = `
  <button class="back" type="button" data-action="home">← All boxes</button>
  <div class="cols"><div>
    <section class="card">
      <div class="hero"><div><h1>${esc(n.label || n.nodeId)}</h1>
          <div class="ids">${esc(n.nodeId)}${n.customerRef ? ' · ref ' + esc(n.customerRef) : ''}</div>
          <div>${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
        <div class="formrow"><span class="bill ${esc(n.billingState)}">${esc(n.billingState)}</span><span class="st ${esc(n.status)}">${esc(n.status)}</span>
          <button type="button" class="btn sm ghost" data-action="refresh">Refresh</button></div></div>
      <div class="kv">
        <div><div class="k">Last check-in</div><div class="v">${fmtAgo(n.lastSeenAgoSeconds)}</div></div>
        <div><div class="k">Uptime</div><div class="v">${fmtDur(n.uptimeSeconds)}</div></div>
        <div><div class="k">Agent</div><div class="v mono">${esc(n.agentVersion || DASH)}</div></div>
        <div><div class="k">DNS filter</div><div class="v ${n.piholeReachable ? 't-ok' : 't-bad'}">${n.piholeReachable ? 'reachable' : 'unreachable'}</div></div>
      </div>
      <div class="meters">
        ${meter('Processor', cpu, cpu == null ? DASH + ' not reported' : cpu.toFixed(0) + '%', 75, 90)}
        ${meter('Memory', mp, mp == null ? DASH + ' not reported' : `${(h.memUsedMB / 1024).toFixed(1)} / ${(h.memTotalMB / 1024).toFixed(1)} GB`, 80, 92)}
        ${meter('Storage', disk, disk == null ? DASH + ' not reported' : disk.toFixed(0) + '%', 85, 95)}
        ${meter('Temperature', temp == null ? null : (temp / 85) * 100, temp == null ? DASH + ' not reported' : temp.toFixed(1) + ' °C', 82, 94)}
      </div>
      <div class="kv">
        <div><div class="k">Errors · 24 h</div><div class="v">${errs == null ? DASH : errs}</div></div>
        <div><div class="k">Restarts · 24 h</div><div class="v">${rst == null ? DASH : rst}</div></div>
        <div><div class="k">Throttle flags</div><div class="v mono">${esc(h.throttleFlags || DASH)}</div></div>
        <div><div class="k">First seen</div><div class="v">${fmtDate(n.firstSeenAt)}</div></div>
      </div>
      <div class="mods">${mods || '<span class="muted">No modules reported.</span>'}</div>
      ${gaps}
    </section>

    <section class="card"><div class="card-h"><div><h2>Support view</h2>
        <div class="sub">Read from this box's last check-in (${fmtAgo(n.lastSeenAgoSeconds)}). Nothing here was probed live — this console cannot reach a customer's box.</div></div></div>
      ${findings || '<div class="allclear">Nothing needs attention. Every module this box is expected to run is running, and no threshold was crossed.</div>'}
    </section>

    <section class="card"><div class="card-h"><div><h2>History</h2><div class="sub">${esc(history.resolution || '')} · ${pts.length} point${pts.length === 1 ? '' : 's'}</div></div>
        <div class="chips">${winBtns}</div></div>${charts}</section>

    <section class="card"><div class="card-h"><div><h2>Gate^Flame Shield</h2>
        <div class="sub">Device names are the owner's own, exactly as on their phone.</div></div>
        ${sh && sh.configured ? `<span class="chip on">${num(sh.enabledCount) ?? DASH} of ${(sh.devices || []).length} on</span>` : ''}</div>
      ${shieldBody}</section>
  </div><div>
    <section class="card"><h3>Your record</h3><div class="sub">Kept on this server only. Never sent to the box.</div>
      <form id="adminForm" autocomplete="off">
        <div class="field"><label for="a-label">Name for this box</label><input id="a-label" maxlength="64" value="${esc(n.label || '')}" placeholder="e.g. Van Wyk · Centurion"></div>
        <div class="field"><label for="a-ref">Customer reference</label><input id="a-ref" maxlength="64" value="${esc(n.customerRef || '')}" placeholder="your own reference"></div>
        <div class="field"><label for="a-tags">Tags, comma separated</label><input id="a-tags" value="${esc((n.tags || []).join(', '))}" placeholder="batch-3, reseller-x"></div>
        <div class="field"><label for="a-bill">Billing state</label><select id="a-bill">
          ${['active', 'trial', 'suspended', 'unpaid', 'cancelled', 'unknown'].map((b) => `<option value="${b}" ${n.billingState === b ? 'selected' : ''}>${b}</option>`).join('')}
        </select></div>
        <div class="formrow"><button class="btn primary" type="submit">Save</button><span class="savemsg" id="a-msg"></span></div>
      </form></section>

    <section class="card"><h3>Remote support</h3>
      <div class="notice">Not available yet. Boxes post outward only — nothing reaches back, so this console can watch a box but cannot change one.
        The chosen design is a persistent per-box tunnel, which needs the same control plane Shield is waiting on.</div>
    </section>

    ${tokenCard(n)}

    <section class="card"><h3>Support log</h3>
      <form id="noteForm"><div class="field"><textarea id="n-body" rows="3" maxlength="4000" placeholder="What happened, what you did…"></textarea></div>
        <div class="formrow"><button class="btn primary" type="submit">Add note</button><span class="savemsg" id="n-msg"></span></div></form>
      ${(n.notes || []).length ? n.notes.map((x) => `<div class="note"><div class="meta">${fmtDate(x.createdAt)} · ${esc(x.author || '')}</div><div class="body">${esc(x.body)}</div></div>`).join('')
        : '<div class="notice">No notes yet.</div>'}
    </section>
  </div></div>`;
  applyWidths($('view'));
}

/* Feed token. Three states, each from the detail JSON and nothing else: none on
 * file, issued but never used by the box, in use by the box. */
function tokenCard(n) {
  const issued = num(n.tokenIssuedAt), used = num(n.tokenActivatedAt);
  const stateLine = issued == null
    ? 'No token on file. The box’s next check-in with the shared enrolment token enrols it and issues a fresh one.'
    : used == null
      ? 'Issued, but the box has not posted with it yet — as far as this server knows, the box is still on the shared enrolment token.'
      : 'The box has posted with its own token since ' + fmtDate(used) + '. The shared enrolment token can no longer post as this box.';
  return `<section class="card"><h3>Feed token</h3>
      <div class="sub">The credential this box posts its check-ins with. This server keeps only a hash of it.</div>
      <div class="kv kv-2">
        <div><div class="k">Issued</div><div class="v">${fmtDate(issued)}</div></div>
        <div><div class="k">First used by the box</div><div class="v">${issued == null ? DASH : used == null ? 'not yet' : fmtDate(used)}</div></div>
      </div>
      <div class="notice tokenstate">${esc(stateLine)}</div>
      <div class="sub tokenhelp">For a box that was re-imaged or lost its token: its check-ins are refused while this server holds a token the box no longer has.</div>
      <div class="formrow tokenrow"><button type="button" class="btn sm danger" data-action="forget-token"${issued == null ? ' disabled' : ''}>Forget token (re-enrol)</button>
        <span class="savemsg" id="t-msg"></span></div>
    </section>`;
}

async function forgetToken() {
  const n = detail;
  if (!n || num(n.tokenIssuedAt) == null) return;
  const ok = window.confirm(`Forget the feed token for ${n.label || n.nodeId}?\n\n`
    + '• The token on file stops working immediately.\n'
    + '• The box’s next check-in with the shared enrolment token enrols it again, with a fresh token.\n'
    + '• History, notes and your record are kept. The support log records who did this.\n\n'
    + 'Until the box re-enrols, anyone holding the shared enrolment token could enrol as it. '
    + 'A box that still holds the old token and runs an agent without the BUG-30 fix will not fall back to the shared token.');
  if (!ok) return;
  const before = n.tokenIssuedAt, id = state.nodeId;
  const msg = $('t-msg'); msg.className = 'savemsg'; msg.textContent = 'forgetting…';
  let failed = null;
  try {
    await api('api/v1/nodes/' + encodeURIComponent(id) + '/token', { method: 'DELETE' });
  } catch (e) {
    if (e.kind === 'auth') return;
    failed = e;
  }
  // Read back from the detail rather than trust the DELETE's answer.
  await showNode(true);
  const m2 = $('t-msg');
  if (!m2 || state.nodeId !== id) return;
  const after = detail ? num(detail.tokenIssuedAt) : null;
  if (failed) {
    m2.className = 'savemsg bad';
    m2.textContent = (failed.status === 404 ? 'nothing forgotten — ' : 'not forgotten — ') + failed.message;
  } else if (after == null) {
    m2.className = 'savemsg ok'; m2.textContent = 'forgotten: no token on file now. The box re-enrols on its next check-in.';
  } else if (after !== before) {
    m2.className = 'savemsg ok'; m2.textContent = 'forgotten, and the box has already re-enrolled (fresh token issued ' + fmtDate(after) + ').';
  } else {
    m2.className = 'savemsg bad'; m2.textContent = 'the server answered, but the old token is still on file — not confirmed.';
  }
}

async function saveAdmin(ev) {
  ev.preventDefault();
  const msg = $('a-msg'); msg.className = 'savemsg'; msg.textContent = 'saving…';
  try {
    await api('api/v1/nodes/' + encodeURIComponent(state.nodeId) + '/admin', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: $('a-label').value, customerRef: $('a-ref').value,
        tags: $('a-tags').value.split(',').map((s) => s.trim()).filter(Boolean), billingState: $('a-bill').value,
      }),
    });
    // Re-read rather than trust the write: the server normalises what it stores.
    await showNode(true);
    const m2 = $('a-msg'); if (m2) { m2.className = 'savemsg ok'; m2.textContent = 'saved'; }
  } catch (e) { if (e.kind !== 'auth') { msg.className = 'savemsg bad'; msg.textContent = 'not saved: ' + e.message; } }
}

async function addNote(ev) {
  ev.preventDefault();
  const el = $('n-body'), msg = $('n-msg');
  if (!el.value.trim()) return;
  msg.className = 'savemsg'; msg.textContent = 'saving…';
  try {
    await api('api/v1/nodes/' + encodeURIComponent(state.nodeId) + '/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: el.value }),
    });
    await showNode(true);
  } catch (e) { if (e.kind !== 'auth') { msg.className = 'savemsg bad'; msg.textContent = 'not saved: ' + e.message; } }
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, v = el.dataset.v;
  if (a === 'home') { go('#/'); }
  else if (a === 'node') { go('#/node/' + encodeURIComponent(v)); }
  else if (a === 'status' || a === 'tag' || a === 'billing') { state[a] = state[a] === v ? '' : v; loadFleet(); }
  else if (a === 'sort') { state.sort = v; loadFleet(); }
  else if (a === 'clear') { state.q = ''; state.status = ''; state.tag = ''; state.billing = ''; loadFleet(); }
  else if (a === 'window') { state.window = v; go('#/node/' + encodeURIComponent(state.nodeId) + '?w=' + v); }
  else if (a === 'refresh') { showNode(true); }
  else if (a === 'forget-token') { forgetToken(); }
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('tr[data-action="node"]')) {
    ev.preventDefault(); ev.target.click();
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { state.q = ev.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => loadFleet(), 250); }
});
document.addEventListener('change', (ev) => { if (ev.target.id === 'sort') { state.sort = ev.target.value; loadFleet(); } });
document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'adminForm') saveAdmin(ev);
  else if (ev.target.id === 'noteForm') addNote(ev);
});
window.addEventListener('hashchange', route);
if (reduceMotion) document.documentElement.classList.add('reduced-motion');

api('api/v1/session').then((s) => { $('who').textContent = s.user; }).catch(() => {});
route();
})();

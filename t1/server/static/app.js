// Gate^Flame T1 dashboard. Renders only what the server reports - no invented numbers.
const API = '/api/t1/v1';
let selected = null;
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
const ago = (t) => { if (!t) return 'never'; const s = Date.now() / 1000 - t;
  return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`; };
const dur = (s) => s == null ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`;
const when = (t) => t ? new Date(t * 1000).toLocaleString() : '—';

function token() { try { return localStorage.getItem('t1admin') || ''; } catch { return ''; } }
async function api(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-T1-Admin': token(), ...(opts.headers || {}) } });
  if (r.status === 401) {
    const t = prompt('Admin token (python -m t1server admin-token on the server). Not needed on the server machine itself.');
    if (t) { try { localStorage.setItem('t1admin', t); } catch {} return api(path, opts); }
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

function card(v, l) { return `<div class="card"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`; }

async function refresh() {
  let st;
  try { st = await api('/status'); $('#srv').className = 'pill online'; $('#srv').textContent = `server up ${dur(st.server.uptime_s)}`; }
  catch (e) { $('#srv').className = 'pill offline'; $('#srv').textContent = `server unreachable: ${e.message}`; return; }
  const f = st.fleet;
  $('#cards').innerHTML = card(f.devices, 'T1 devices') + card(f.health.online, 'online') +
    card(f.health.stale + f.health.offline, 'stale / offline') + card(f.protection.PROTECTED || 0, 'protected') +
    card(num(f.queries), 'queries (since each boot)') + card(num(f.blocked), 'blocked') + card(f.out_of_date.length, 'on an old filter');

  const b = st.build;
  $('#buildstate').textContent = b.running ? `building… started ${ago(b.started)}` :
    b.error ? `last build FAILED: ${b.error}` : b.finished ? `last build ${ago(b.finished)}` : 'no build this session';
  $('#build').disabled = b.running;
  $('#buildlog').classList.toggle('hidden', !b.log.length);
  $('#buildlog').textContent = b.log.join('\n');
  $('#filters tbody').innerHTML = Object.entries(st.levels).map(([lv, x]) => {
    const src = x.sources ? Object.entries(x.sources).map(([u, s]) => `<div title="${esc(u)}">${esc(u.split('/').slice(2, 4).join('/'))}: ${s ? num(s.domains) + ' · ' + esc(s.origin) : 'not read'}</div>`).join('') : '';
    return `<tr><td><b>${esc(lv)}</b></td><td>${esc(x.description)}</td><td>${x.version ? when(x.version) : '<span class="offline">not built</span>'}</td>
      <td>${num(x.domains)}</td><td>${x.bytes ? (x.bytes / 1e6).toFixed(2) + ' MB' : '—'}</td>
      <td>${x.fp_rate != null ? (x.fp_rate * 100).toFixed(3) + ' %' : '—'}</td><td class="muted">${src}</td></tr>`;
  }).join('');

  const devs = await api('/devices');
  $('#nodev').textContent = devs.length ? '' : 'No T1 device has reported yet. Flash one with tools\\T1-BUILD-FLASH.cmd.';
  $('#devices tbody').innerHTML = devs.map((d) => `<tr class="${d.id === selected ? 'sel' : ''}">
    <td><b>${esc(d.label)}</b><div class="muted">${esc(d.ip)}</div></td>
    <td><span class="pill ${d.health}">${d.health}</span><div class="muted">${ago(d.last_seen)}</div></td>
    <td><span class="pill ${esc(d.status_label)}">${esc(d.status_label)}</span>${d.status === 'paused' && d.paused_left ? `<div class="muted">${dur(d.paused_left)} left</div>` : ''}${d.status !== 'bypass' && d.err ? `<div class="muted">${esc(d.err)}</div>` : ''}</td>
    <td>${esc(d.level)}</td>
    <td>${d.filter_version ? when(d.filter_version) : '—'}<div class="${d.filter_current ? 'muted' : 'stale'}">${d.filter_current ? 'current' : 'update pending'}</div></td>
    <td>${num(d.queries)}</td><td>${num(d.blocked)}${d.blocked_pct != null ? ` <span class="muted">(${d.blocked_pct} %)</span>` : ''}</td>
    <td>${d.qps != null ? d.qps + ' q/s' : '—'}</td><td>${d.rssi != null ? esc(d.rssi) + ' dBm' : '—'}</td>
    <td>${dur(d.uptime)}</td><td>${esc(d.fw)}</td><td><button onclick="pick('${esc(d.id)}')">Open</button></td></tr>`).join('');

  const al = await api('/allowlist');
  $('#allow').innerHTML = al.entries.map((e) => `<tr><td>${esc(e.domain)}</td><td class="muted">${ago(e.added)}</td>
    <td><button onclick="unallow('${esc(e.domain)}')">Remove</button></td></tr>`).join('') || '<tr><td class="muted">empty</td></tr>';

  const ev = await api('/events?limit=40');
  $('#events').innerHTML = ev.map((e) => `<tr><td class="muted">${when(e.ts)}</td><td>${esc(e.device_id || 'server')}</td><td>${esc(e.kind)}</td><td>${esc(e.detail)}</td></tr>`).join('');
  if (selected) detail();
}

window.pick = (id) => { selected = id; $('#detail').classList.remove('hidden'); detail(); refresh(); };
window.unallow = async (d) => { await api('/allowlist/' + encodeURIComponent(d), { method: 'DELETE' }); refresh(); };

async function detail() {
  const d = await api('/devices/' + encodeURIComponent(selected));
  $('#dtitle').textContent = `${d.label} — ${d.status_label}`;
  const kv = { 'Device ID': d.id, 'IP': d.ip, 'Firmware': d.fw, 'First seen': when(d.first_seen), 'Upstream DNS': d.upstream,
    'Filter version': d.filter_version ? when(d.filter_version) : 'none', 'Allow-list version': d.allow_version ? when(d.allow_version) : 'none',
    'Forwarded': num(d.forwarded), 'Upstream timeouts': num(d.timeouts), 'Free heap': num(d.heap_free) + ' B',
    'PSRAM free / total': `${num(d.psram_free)} / ${num(d.psram_total)} B` };
  $('#dkv').innerHTML = Object.entries(kv).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  $('#dcmdlog').innerHTML = d.commands.map((c) => `<tr><td>#${c.id} ${esc(c.cmd)} ${esc(c.arg || '')}</td>
    <td class="muted">${c.result_ts ? (c.result_ok ? 'ok' : 'FAILED') + ': ' + esc(c.result) : c.delivered ? 'delivered' : 'queued'}</td></tr>`).join('');
  drawChart(d.series);
}

function drawChart(s) {
  const cv = $('#chart'), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const pts = [];
  for (let i = 1; i < s.length; i++) { const a = s[i - 1], b = s[i]; const dt = b.ts - a.ts;
    if (b.boot === a.boot && dt > 0) pts.push({ t: b.ts, q: (b.q - a.q) / dt * 60, k: (b.blk - a.blk) / dt * 60 }); }
  g.fillStyle = '#8b98a8'; g.font = '12px system-ui';
  if (pts.length < 2) { g.fillText('Not enough telemetry yet for a chart (needs two reports from the same boot).', 12, 24); return; }
  const max = Math.max(1, ...pts.map((p) => p.q)), t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = (t) => 40 + (t - t0) / (t1 - t0 || 1) * (cv.width - 50), Y = (v) => cv.height - 20 - v / max * (cv.height - 40);
  g.fillText(`${Math.round(max)}/min`, 4, 16); g.fillText('queries/min (white) · blocked/min (orange) · last 24 h', 60, 16);
  for (const [key, col] of [['q', '#e6edf3'], ['k', '#ff6a2b']]) {
    g.strokeStyle = col; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, X(p.t), Y(p[key]))); g.stroke(); }
}

document.querySelectorAll('#dcmds button[data-c]').forEach((b) => b.onclick = async () => {
  if (b.dataset.c === 'reboot' && !confirm('Reboot this device? DNS falls back to the router for ~20 s.')) return;
  try { await api(`/devices/${encodeURIComponent(selected)}/cmd`, { method: 'POST', body: JSON.stringify({ command: b.dataset.c, arg: b.dataset.a || '' }) }); detail(); }
  catch (e) { alert(e.message); }
});
$('#setlevel').onclick = async () => { await api(`/devices/${encodeURIComponent(selected)}/cmd`, { method: 'POST', body: JSON.stringify({ command: 'set_level', arg: $('#dlevel').value }) }); detail(); };
$('#build').onclick = async () => { await api('/filters/build', { method: 'POST' }); refresh(); };
$('#check').onclick = async () => { try { const r = await api(`/check?domain=${encodeURIComponent($('#cdom').value)}&level=${$('#clevel').value}`);
  $('#cres').textContent = `${r.domain} on ${r.level || '?'}: ${r.verdict}`; } catch (e) { $('#cres').textContent = e.message; } };
$('#aadd').onclick = async () => { try { await api('/allowlist', { method: 'POST', body: JSON.stringify({ domain: $('#adom').value }) }); $('#adom').value = ''; refresh(); } catch (e) { alert(e.message); } };

refresh(); setInterval(refresh, 5000);

#!/usr/bin/env python3
"""Gate^Flame - export Cowork chat transcripts (.jsonl) to readable, secret-scrubbed Markdown.

Keeps: every message Dennis typed, every reply Claude wrote, a one-line record of each
tool call (name + the key argument, truncated), and compaction summaries.
Drops: thinking blocks, tool RESULTS (bulk output), injected system reminders.

Usage: python3 export-chats.py <raw_dir> <out_dir>
  raw_dir holds <id>.jsonl + <id>.meta.json (the Cowork session record, for the title).
"""
import json, re, sys, pathlib, datetime

SECRET_PATTERNS = [
    (re.compile(r'sk-ant-[A-Za-z0-9_\-]{10,}'), '[REDACTED-ANTHROPIC-KEY]'),
    (re.compile(r'sk-[A-Za-z0-9]{20,}'), '[REDACTED-API-KEY]'),
    (re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}'), '[REDACTED-GITHUB-TOKEN]'),
    (re.compile(r'github_pat_[A-Za-z0-9_]{20,}'), '[REDACTED-GITHUB-TOKEN]'),
    (re.compile(r'AIza[0-9A-Za-z_\-]{35}'), '[REDACTED-GOOGLE-KEY]'),
    (re.compile(r'AKIA[0-9A-Z]{16}'), '[REDACTED-AWS-KEY]'),
    (re.compile(r'xox[abprs]-[A-Za-z0-9\-]{10,}'), '[REDACTED-SLACK-TOKEN]'),
    (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----', re.S), '[REDACTED-PRIVATE-KEY]'),
]
# key=value / "key": "value" / user:pass shapes. The captured VALUE is remembered so that
# every later occurrence of the same literal is redacted too, whatever surrounds it.
KV = [
    re.compile(r'(?i)(?:store|key)?pass(?:word|wd|phrase)?["\']?\s*[=:]\s*["\']?([^\s"\'<>`,;)]{6,})'),
    re.compile(r'(?i)(?:secret|api[_-]?key|auth[_-]?token|access[_-]?token|bearer)["\']?\s*[=:\s]\s*["\']?([^\s"\'<>`,;)]{8,})'),
    re.compile(r'(?i)\b(?:admin|root|wabapi|pi|user)\s*:\s*([^\s\'"@/:]{8,})(?=[\'"\s@])'),
]
# Long high-entropy runs (base64 keystores, tokens): mixed upper+lower+digit, >=32 chars.
ENTROPY = re.compile(r'(?<![A-Za-z0-9+/=_\-])[A-Za-z0-9+/=_\-]{32,}(?![A-Za-z0-9+/=_\-])')
SYSREM = re.compile(r'<system-reminder>.*?</system-reminder>', re.S)
KNOWN: set = set()

def _entropy(m):
    s = m.group(0)
    # Paths and file names break into short segments at / - _ . ; an encoded key or token
    # has one long unbroken run mixing upper, lower and digits.
    for run in re.findall(r'[A-Za-z0-9+=]{24,}', s):
        if re.search(r'[A-Z]', run) and re.search(r'[a-z]', run) and re.search(r'\d', run) \
                and len(set(run)) >= 16:
            return '[REDACTED-BLOB]'
    return s

def learn(text: str):
    for rx in KV:
        for m in rx.finditer(text):
            v = m.group(1)
            # A real secret here is one opaque token: letters AND digits, no path/regex/
            # English-word shape. Words like "credential" or "http" must never be learned,
            # because every later occurrence of a learned literal is blanked.
            if (len(v) >= 8 and re.fullmatch(r'[A-Za-z0-9_\-.!@#%^&*+]+', v)
                    and re.search(r'\d', v) and re.search(r'[A-Za-z]', v)
                    and not re.fullmatch(r'[\d.]+', v) and '..' not in v):
                KNOWN.add(v)

def scrub(t: str) -> str:
    t = SYSREM.sub('', t)
    for rx, rep in SECRET_PATTERNS:
        t = rx.sub(rep, t)
    for v in sorted(KNOWN, key=len, reverse=True):
        t = t.replace(v, '[REDACTED]')
    t = ENTROPY.sub(_entropy, t)
    return t.strip()

def tool_line(b):
    name = b.get('name', '?').replace('mcp__', '')
    inp = b.get('input') or {}
    key = next((inp[k] for k in ('command', 'file_path', 'path', 'url', 'query', 'pattern', 'description', 'subject', 'message') if k in inp), '')
    key = scrub(str(key)).replace('\n', ' ')
    if len(key) > 220:
        key = key[:220] + ' ...'
    arg = ('`' + key.replace('`', "'") + '`') if key else ''
    return f"- `tool` **{name}** {arg}"

def ts(o):
    try:
        return datetime.datetime.fromisoformat(o['timestamp'].replace('Z', '+00:00')).astimezone(
            datetime.timezone(datetime.timedelta(hours=2))).strftime('%Y-%m-%d %H:%M SAST')
    except Exception:
        return ''

def convert(jsonl: pathlib.Path, meta: dict, out_dir: pathlib.Path):
    title = meta.get('title') or jsonl.stem
    sid = meta.get('sessionId', jsonl.stem)
    lines, first, last, n_user, n_claude = [], None, None, 0, 0
    pending_tools = []

    def flush_tools():
        if pending_tools:
            lines.append('\n'.join(pending_tools)); lines.append('')
            pending_tools.clear()

    for raw in jsonl.open(encoding='utf-8', errors='replace'):
        try:
            o = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if o.get('type') not in ('user', 'assistant') or o.get('isSidechain'):
            continue
        stamp = ts(o); first = first or stamp; last = stamp or last
        c = o.get('message', {}).get('content')
        blocks = [{'type': 'text', 'text': c}] if isinstance(c, str) else (c or [])
        if o['type'] == 'user':
            if o.get('isCompactSummary'):
                flush_tools(); lines += [f'### ⟲ Context compacted ({stamp}) — summary carried forward', '', '<details><summary>summary</summary>', '', scrub(''.join(b.get('text', '') for b in blocks if b.get('type') == 'text')), '', '</details>', '']
                continue
            texts = [scrub(b.get('text', '')) for b in blocks if b.get('type') == 'text']
            texts = [t for t in texts if t and not t.startswith('<local-command') and not t.startswith('<command-')]
            if not texts:
                continue
            if o.get('isMeta') and all(len(t) < 80 for t in texts):
                flush_tools(); lines += [f'*({stamp}) {" ".join(texts)}*', '']; continue
            flush_tools(); n_user += 1
            lines += [f'## 🧑 Dennis — {stamp}', '', *texts, '']
        else:
            for b in blocks:
                t = b.get('type')
                if t == 'text' and b.get('text', '').strip():
                    flush_tools(); n_claude += 1
                    lines += [f'## 🤖 Claude — {stamp}', '', scrub(b['text']), '']
                elif t == 'tool_use':
                    pending_tools.append(tool_line(b))
    flush_tools()
    date = (first or '0000-00-00')[:10]
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:50]
    out = out_dir / f'{date}_{sid.replace("local_", "")[:8]}_{slug}.md'
    head = [
        '```',
        '=' * 88,
        f'GATE^FLAME — CHAT ARCHIVE: "{title}"',
        'Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI',
        'Founder: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI',
        f'Source: Cowork session {sid} | project "Gate^Flame Finishing touches"',
        f'Exported: 2026-09-25 SAST | Span: {first} → {last}',
        'Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2',
        'Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.',
        '=' * 88,
        '```', '',
        '> ⛔ Historical record, not live truth. Messages and replies are verbatim; tool output',
        '> is omitted (one line per tool call is kept). Secrets were machine-redacted on export.',
        '', f'# {title}', '',
    ]
    out.write_text('\n'.join(head + lines) + '\n', encoding='utf-8')
    return out, first, last, n_user, n_claude, title

if __name__ == '__main__':
    raw, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)

    def walk(x):
        if isinstance(x, str):
            learn(x)
        elif isinstance(x, dict):
            for v in x.values(): walk(v)
        elif isinstance(x, list):
            for v in x: walk(v)
    # Pass 1: learn every secret literal from EVERYTHING, tool output included, across all
    # sessions - a password printed by a tool in one chat gets typed bare in another.
    for j in sorted(raw.glob('*.jsonl')):
        for line in j.open(encoding='utf-8', errors='replace'):
            try: walk(json.loads(line).get('message'))
            except Exception: pass
    print(f'learned {len(KNOWN)} secret literals', file=sys.stderr)
    for j in sorted(raw.glob('*.jsonl')):
        mp = raw / f'{j.stem}.meta.json'
        meta = json.loads(mp.read_text(encoding='utf-8', errors='replace')) if mp.exists() else {}
        out, a, b, u, c, title = convert(j, meta, dst)
        print(f'{out.name}\t{a}\t{b}\tdennis={u}\tclaude={c}\t{out.stat().st_size}\t{title}')

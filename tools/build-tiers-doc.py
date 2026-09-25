#!/usr/bin/env python3
"""Build docs/Ionity_Gate^Flame-Tiers&Models.docx on the official AEDI template.

THE CONTENT LIVES IN THIS FILE (the SECTIONS list below). To update the document, edit
the data here and re-run - never hand-edit the .docx, or the next rebuild loses it.

  python3 tools/build-tiers-doc.py [--template docs/templates/TEMPLATE_2026_OFFICAL_v1.1.1.docx]
                                   [--out "docs/Ionity_Gate^Flame-Tiers&Models.docx"]
                                   [--pages "1:3,2:4,..."]   # index page numbers (section:page)

Page numbers are measured, not guessed: render the result to PDF, find each heading's
page, and re-run with --pages (tools/build-tiers-doc.sh does both passes).
"""
from __future__ import annotations

import argparse
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

REPO = Path(__file__).resolve().parents[1]
DOC_ID = "ION-GF-TIERS-2026-001"
VERSION = "1.0"
DATE = "25 September 2026"

# ── content ───────────────────────────────────────────────────────────────────────────
# Block types: ("p", text) ("b", [bullets]) ("n", [numbered]) ("kv", [(k, v), ...])
# ("t", header, rows, widths) ("h2", text) ("note", text). **bold** inside text is honoured.

TBD = "To be defined"

SECTIONS = [
    {"title": "Why Gate^Flame Exists", "blocks": [
        ("p", "**Gate^Flame™** is Ionity Global's home and small-office network protection device. It sits on the "
              "customer's network and stops malicious and unwanted domains — advertising, trackers, malware and phishing "
              "sites — from being reached, before any device in the house connects to them."),
        ("p", "**The problem.** Every household device resolves names through the ISP's DNS, with no filtering and "
              "no visibility for the owner. Filtering on each phone, TV and laptop separately is impractical, and most "
              "routers offer nothing usable."),
        ("p", "**The approach.** Gate^Flame filters at the network's own DNS. In the Standard editions it is a "
              "**side-car**: the router uses Gate^Flame as its upstream DNS, household traffic never passes through the "
              "box, and if the box loses power (load shedding) the router falls back on its own. The connection cannot "
              "be made slower by the box, and every blocked tracker is a request never made (ADR-001)."),
        ("p", "**The business.** Every unit reports to Ionity's fleet console, which provides status reporting, remote "
              "support and the basis of the monthly subscription. A guided help menu (IoniBot) in the mobile app replaces "
              "a call centre."),
        ("p", "**The range.** Four tiers, T1 to T4, each in a **Standard** and a **Premium** edition, from a low-cost "
              "microcontroller filter (T1) to the full appliance with a touch-screen kiosk (T3) and beyond. This document "
              "defines each model's hardware, setup, deployment method and features, and is updated as each is decided."),
        ("note", "Wording rule: the product filters DNS. Say \"Your network is filtered\" — never \"your family is safe\" — "
                 "and never claim intrusion detection or 100 % coverage."),
    ]},
    {"title": "Tier Structure at a Glance", "blocks": [
        ("t", ["Tier", "Standard", "Premium"], [
            ["T1", "ESP32-S3 DNS filter + Ionity server — Lab build v0.1", TBD],
            ["T2", TBD, TBD],
            ["T3", "Radxa Cubie A7A 6 GB appliance with kiosk — Established", "Standard T3 + crypto-wallet safeguarding, 16 GB — Direction set"],
            ["T4", TBD, TBD],
        ], [1000, 4030, 4030]),
        ("h2", "Status stamps used in this document"),
        ("kv", [("Established", "Built and running on a lab unit; details below are measured, not planned."),
                ("Lab build", "Code exists and is tested on the bench/simulator; not yet on production hardware."),
                ("Direction set", "Dennis has decided what it is; the specification is still open."),
                (TBD, "A reserved slot in the range. Nothing decided yet.")]),
    ]},
    # ── T1 ──
    {"title": "Gate^Flame Tier 1 — Standard", "blocks": [
        ("kv", [("Status", "Lab build v0.1 (25 Sep 2026): server running, filters built, firmware compiles cleanly. "
                           "Not yet tested on a physical board."),
                ("Role", "Low-cost side-car DNS filter; the heavy lifting runs on the Ionity server."),
                ("Code", "Repository Gate-Flame, folder t1/ (separate from the ESP32-MCP project).")]),
        ("h2", "Hardware"),
        ("b", ["**ESP32-S3 N16R8** — 16 MB flash and 8 MB octal PSRAM. The PSRAM is required: the largest filter is 5.5 MB.",
               "2.4 GHz Wi-Fi (802.11 b/g/n). No Ethernet on the reference board.",
               "5 V USB-C power; RGB status LED — green protected, amber paused/applying, red unprotected or degraded, blue no Wi-Fi.",
               "9 MB internal file partition keeps the signed filter, so protection resumes after a power cut without the server.",
               "Raspberry Pi Pico 2 / Pico 2 W: accessory role only (display, sensor). Too little memory for the full list, and the Pico 2 has no radio.",
               "Enclosure, power supply and bill of materials: " + TBD.lower() + "."]),
        ("h2", "Setup"),
        ("n", ["The Ionity T1 server builds and digitally signs one filter per protection level from the same blocklists as T3.",
               "The board is flashed with the Gate^Flame T1 firmware; the Wi-Fi password is entered on the installer's PC and never sent anywhere else.",
               "The board is given a fixed address (router DHCP reservation, or a static address at flashing).",
               "The router's upstream DNS is set to the board's address — not the DNS it hands to devices.",
               "The board finds the server (mDNS, or a fallback address), downloads the filter, checks the signature and starts filtering. "
               "Setup only counts as complete once the board has reported to the server."]),
        ("h2", "Deployment Method"),
        ("b", ["Side-car, exactly as T3 (ADR-001): household devices are never pointed at the board; if it is off, the router falls back automatically.",
               "Allowed look-ups go to Quad9 (9.9.9.9 / 149.112.112.112), never back to the router. After 3 s without an answer the board tells the router to use its own upstream.",
               "Managed from the Ionity server: dashboard, remote commands and an AI (MCP) interface. For now the server runs on Ionity's own workstation; a hosted server follows."]),
        ("h2", "Features and Functionalities"),
        ("b", ["DNS filtering at three levels, same lists as T3. Build of 25 Sep 2026: **low 340,446 domains, medium 3,023,751, high 3,037,423**.",
               "Level descriptions are the product's own: low — \"Blocks ads and trackers. Safest - very unlikely to break a website.\"; "
               "medium — \"Adds malware and phishing protection. Recommended for most homes.\"; high — \"Adds aggressive tracking and telemetry blocking. May occasionally break a site.\"",
               "Blocked names answer 0.0.0.0 / :: , the same behaviour as T3.",
               "About 1 look-up in 1,000 can be blocked by mistake (compact filter). The dashboard shows whether a block is a real list entry or such a false positive, and a fleet-wide allow-list fixes it.",
               "Remote commands: pause (1–1,440 minutes), resume, update filter, change level, change upstream, identify (blink), reboot.",
               "Protection status uses the same five states as T3: PROTECTED, PAUSED, UNPROTECTED, DEGRADED, APPLYING.",
               "Every filter and allow-list is signed and checked on the board, and re-checked at every start-up.",
               "Privacy: the board reports counters only. No domain name ever leaves the board.",
               "Fleet dashboard (filters, devices, activity chart, event log) and ten AI tools (t1_*) on the Ionity server."]),
        ("h2", "Not in T1 Standard (compared with T3)"),
        ("b", ["No kiosk display, no content categories (adult, gambling, social, misinformation), no Shield VPN, no device list, no mobile app yet.",
               "No DNS over TCP, no answer cache, no encrypted upstream (DoT) yet."]),
        ("h2", "Required before T1 is sold"),
        ("b", ["Signed over-the-air firmware updates; secure boot and flash encryption; one token per board.",
               "Bench-measured throughput and added latency on real hardware.",
               "Radio compliance (ICASA type approval in South Africa) — use a pre-certified module.",
               "Enclosure, power supply, price and subscription."]),
    ]},
    {"title": "Gate^Flame Tier 1 — Premium", "tbd": True, "blocks": [
        ("kv", [("Status", TBD)]),
        ("p", "No decision yet. This slot is reserved in the range."),
        ("h2", "Hardware"), ("p", TBD), ("h2", "Setup"), ("p", TBD),
        ("h2", "Deployment Method"), ("p", TBD), ("h2", "Features and Functionalities"), ("p", TBD),
        ("note", "Candidate direction (recommendation, not decided): T1 Standard plus content categories and a small display."),
    ]},
    # ── T2 ──
    {"title": "Gate^Flame Tier 2 — Standard", "tbd": True, "blocks": [
        ("kv", [("Status", TBD)]), ("p", "No decision yet. This slot is reserved in the range."),
        ("h2", "Hardware"), ("p", TBD), ("h2", "Setup"), ("p", TBD),
        ("h2", "Deployment Method"), ("p", TBD), ("h2", "Features and Functionalities"), ("p", TBD)]},
    {"title": "Gate^Flame Tier 2 — Premium", "tbd": True, "blocks": [
        ("kv", [("Status", TBD)]), ("p", "No decision yet. This slot is reserved in the range."),
        ("h2", "Hardware"), ("p", TBD), ("h2", "Setup"), ("p", TBD),
        ("h2", "Deployment Method"), ("p", TBD), ("h2", "Features and Functionalities"), ("p", TBD)]},
    # ── T3 ──
    {"title": "Gate^Flame Tier 3 — Standard", "blocks": [
        ("kv", [("Status", "Established. Full software stack running on the lab reference unit (Raspberry Pi 5, 16 GB) on Ionity's "
                           "isolated test network; mobile app 1.0.3 in tester builds."),
                ("Role", "The civilian household appliance: DNS filtering side-car with its own touch-screen kiosk."),
                ("Production board", "Radxa Cubie A7A 6 GB. Running the stack on this board is still to be validated.")]),
        ("h2", "Hardware"),
        ("b", ["**Radxa Cubie A7A, 6 GB RAM**, with the XSG-0504000HEU power supply (sourced from robotics.org.za).",
               "Wired Ethernet to the customer's router.",
               "Local display running the Gate^Flame kiosk — the kiosk is the product's face, not an add-on. Panel model: " + TBD.lower() + ".",
               "Lab reference unit: Raspberry Pi 5, 16 GB."]),
        ("h2", "Setup"),
        ("n", ["One installer puts the node agent, kiosk, DNS watchdog, DNS stack and fleet reporting on a fresh device, with read-back and rollback.",
               "The owner pairs the Gate^Flame mobile app (distributed through Google Play) with the box; the first pairing provisions it.",
               "The owner changes one setting — the router's upstream DNS — guided by a single screen; the box confirms the change by reading it back.",
               "Router IPv6 is corrected at install. The customer is never asked to switch IPv6 off."]),
        ("h2", "Deployment Method"),
        ("b", ["Side-car (ADR-001): the router forwards to Gate^Flame; devices are never pointed at the box. A power cut costs filtering, never the internet.",
               "Household traffic never passes through the box, so it cannot slow the connection; warm cache answers in under 1 ms against 20–40 ms at the ISP.",
               "No secondary DNS, ever. If filtering fails, the watchdog falls back to unfiltered resolvers so the house stays online (UNPROTECTED).",
               "Accepted limits: filtering is not 100 % (the router sometimes uses its own upstream), and look-ups are not attributed per device.",
               "Every unit reports to the Ionity fleet console — the billable surface for status reports, support and the subscription."]),
        ("h2", "Features and Functionalities"),
        ("b", ["Pi-hole v6 filtering with the Unbound recursive resolver, in containers.",
               "Protection level low / medium / high, with the same descriptions as T1 (up to about 3.08 million domains at high).",
               "Content categories: Adult content — \"Blocks pornography and explicit sites.\"; Gambling — \"Blocks online casinos, betting and lottery sites.\"; "
               "Social media — \"Blocks social networks.\"; Misinformation sites — \"Blocks sites widely identified as publishing fabricated news.\"",
               "Pause: 5 minutes, 30 minutes, 2 hours, Until the box restarts, Until I turn it back on.",
               "Five-state protection status: PROTECTED, PAUSED, UNPROTECTED, DEGRADED, APPLYING — with the reason when it is not protected.",
               "A list of the devices connected to the network (no per-device history, by design).",
               "Gate^Flame Shield (in progress): per-device, per-region VPN hand-off. The box only tells a device which region to use; the tunnel runs from the device, never through the box.",
               "Mobile app (Android): Home, Activity, Blocked, Network, Health, Settings and Shield screens, confirmed on a real handset on 15 Sep 2026.",
               "IoniBot: a guided question menu in the mobile app — a live instruction manual, not a live AI.",
               "Fleet reporting to Ionity for remote support and the monthly subscription."]),
    ]},
    {"title": "Gate^Flame Tier 3 — Premium", "blocks": [
        ("kv", [("Status", "Direction set by Dennis on 25 Sep 2026; specification open."),
                ("Definition", "Standard T3 plus enough extra features to safeguard crypto wallets stored on a private server."),
                ("Memory", "16 GB version.")]),
        ("h2", "Hardware"),
        ("b", ["16 GB board — which board is open (the lab Raspberry Pi 5 16 GB is the obvious candidate).",
               "Everything in Standard T3."]),
        ("h2", "Setup"), ("p", "As Standard T3, plus the wallet-server protection set-up. " + TBD + "."),
        ("h2", "Deployment Method"),
        ("p", "Open: protecting a wallet server properly (isolating it, limiting where it may connect) means that "
              "server's traffic must cross the box — an in-path design for that one machine. That reopens the load-shedding "
              "question for the Premium unit only, and needs a deliberate decision."),
        ("h2", "Features and Functionalities"),
        ("b", ["Everything in Standard T3.",
               "Crypto-wallet safeguarding — candidates for decision: isolating the wallet server on its own segment; allowing it to reach only approved exchanges and nodes; "
               "alerting on any new destination; blocking wallet-drainer and phishing domains; a hardware-backed signing step."]),
    ]},
    # ── T4 ──
    {"title": "Gate^Flame Tier 4 — Standard", "tbd": True, "blocks": [
        ("kv", [("Status", TBD)]), ("p", "No decision yet. This slot is reserved in the range."),
        ("h2", "Hardware"), ("p", TBD), ("h2", "Setup"), ("p", TBD),
        ("h2", "Deployment Method"), ("p", TBD), ("h2", "Features and Functionalities"), ("p", TBD)]},
    {"title": "Gate^Flame Tier 4 — Premium", "tbd": True, "blocks": [
        ("kv", [("Status", TBD)]), ("p", "No decision yet. This slot is reserved in the range."),
        ("h2", "Hardware"), ("p", TBD), ("h2", "Setup"), ("p", TBD),
        ("h2", "Deployment Method"), ("p", TBD), ("h2", "Features and Functionalities"), ("p", TBD)]},
    # ── back matter ──
    {"title": "Open Decisions", "blocks": [
        ("t", ["#", "Decision", "Owner"], [
            ["1", "What \"safeguard crypto wallets\" means concretely for Premium T3", "Dennis"],
            ["2", "Whether Premium T3 goes in-path for the wallet server (load shedding)", "Dennis"],
            ["3", "Which 16 GB board Premium T3 uses", "Dennis"],
            ["4", "Definitions of T1 Premium, T2 Standard/Premium, T4 Standard/Premium", "Dennis"],
            ["5", "Price and subscription per tier", "Dennis"],
            ["6", "Validate the T3 stack on the Cubie A7A 6 GB board", "Engineering"],
            ["7", "First T1 on real hardware: throughput, latency, Wi-Fi robustness", "Engineering"],
        ], [700, 6860, 1500]),
    ]},
    {"title": "Recommendations for this Document", "nobreak": True, "blocks": [
        ("n", ["**Add a model code per edition** (e.g. GF-T1S, GF-T1P, GF-T3S, GF-T3P) for labels, invoices, the fleet console and support tickets.",
               "**Add bill of materials, cost and retail price per tier**, and the subscription each includes.",
               "**Add a compliance line per tier**: ICASA type approval for anything with a radio (T1 is Wi-Fi only), POPIA data flows, CE/FCC if exported.",
               "**Add power behaviour per tier**: what the household experiences during load shedding, and an optional UPS.",
               "**Add the support model per tier**: IoniBot, fleet-console access, response times.",
               "**Add an upgrade path** between tiers: same app and fleet account, trade-in value.",
               "**Keep one source of truth**: this document is generated from tools/build-tiers-doc.py in the Gate-Flame repository — edit there and rebuild, so it cannot drift from the product."]),
    ]},
    {"title": "Revision History", "nobreak": True, "blocks": [
        ("t", ["Version", "Date", "Change", "By"], [
            ["1.0", DATE, "First issue: product overview, tier layout, T1 Standard, T3 Standard, T3 Premium direction; other slots reserved.", "Dennis Grobler (Wabakipi)"],
        ], [1000, 1900, 4260, 1900]),
    ]},
]

# ── XML building ──────────────────────────────────────────────────────────────────────
ARIAL = '<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>'


def runs(text: str, size=20, color="000000", italic=False, bold=False) -> str:
    out = []
    for i, part in enumerate(re.split(r"\*\*", text)):
        if not part:
            continue
        b = bold or (i % 2 == 1)
        out.append(f'<w:r><w:rPr>{ARIAL}{"<w:b/><w:bCs/>" if b else ""}{"<w:i/><w:iCs/>" if italic else ""}'
                   f'<w:color w:val="{color}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
                   f'<w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
    return "".join(out)


def para(text, size=20, color="000000", italic=False, bold=False, jc="both", before=80, after=80, extra="") -> str:
    return (f'<w:p><w:pPr>{extra}<w:spacing w:after="{after}" w:before="{before}" w:lineRule="auto"/>'
            f'<w:jc w:val="{jc}"/></w:pPr>{runs(text, size, color, italic, bold)}</w:p>')


def heading(text, level) -> str:
    sp = '<w:spacing w:after="120" w:before="300" w:lineRule="auto"/>' if level == 1 else \
         '<w:spacing w:after="80" w:before="220" w:lineRule="auto"/>'
    return (f'<w:p><w:pPr><w:pStyle w:val="Heading{level}"/>{sp}</w:pPr>'
            f'<w:r><w:rPr>{ARIAL}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')


PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
BORDER = "".join(f'<w:{s} w:color="cccccc" w:space="0" w:sz="4" w:val="single"/>' for s in ("top", "left", "bottom", "right"))
MAR = '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>'


def cell(text, w, header=False, fill=None, jc="left", bold=False) -> str:
    shd = f'<w:shd w:fill="{fill or "0d2137"}" w:val="clear"/>' if (header or fill) else ""
    color = "ffffff" if header else "000000"
    return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/><w:tcBorders>{BORDER}</w:tcBorders>{shd}{MAR}'
            f'<w:vAlign w:val="center"/></w:tcPr>'
            f'<w:p><w:pPr><w:spacing w:after="0" w:before="0"/><w:jc w:val="{jc}"/></w:pPr>'
            f'{runs(text, 18, color, bold=header or bold)}</w:p></w:tc>')


def table(header, rows, widths, first_col_bold=False, first_fill=None) -> str:
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    hdr = ""
    if header:
        hdr = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + "".join(cell(h, w, header=True) for h, w in zip(header, widths)) + "</w:tr>"
    body = ""
    for n, r in enumerate(rows):
        zebra = "f2f9fc" if (header and n % 2) else None      # template index style: alternate rows tinted
        body += "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + "".join(
            cell(v, w, bold=(i == 0 and first_col_bold), fill=(first_fill if i == 0 else zebra))
            for i, (v, w) in enumerate(zip(r, widths))) + "</w:tr>"
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
            f'<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{hdr}{body}</w:tbl>'
            + para("", before=0, after=60))


class Lists:
    """Bullet list = numId 90. Each numbered list gets its own numId so it restarts at 1."""
    def __init__(self):
        self.next = 101
        self.nums: list[int] = []

    def numbered(self) -> int:
        n = self.next
        self.next += 1
        self.nums.append(n)
        return n


def list_items(items, num_id) -> str:
    return "".join(para(t, extra=f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr>', before=30, after=30)
                   for t in items)


def render_blocks(blocks, lists: Lists, sec_no: int, h2_count: list) -> str:
    out = []
    for blk in blocks:
        kind = blk[0]
        if kind == "p":
            out.append(para(blk[1]))
        elif kind == "note":
            out.append(para(blk[1], color="666666", italic=True, before=120, after=80))
        elif kind == "b":
            out.append(list_items(blk[1], 90))
        elif kind == "n":
            out.append(list_items(blk[1], lists.numbered()))
        elif kind == "kv":
            out.append(table(None, [[k, v] for k, v in blk[1]], [2200, 6860], first_col_bold=True, first_fill="e6f7fb"))
        elif kind == "t":
            out.append(table(blk[1], blk[2], blk[3]))
        elif kind == "h2":
            h2_count[0] += 1
            out.append(heading(f"{sec_no}.{h2_count[0]} {blk[1]}", 2))
    return "".join(out)


NUMBERING_ADD = (
    '<w:abstractNum w:abstractNumId="90"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/>'
    '<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="480" w:hanging="260"/></w:pPr>'
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="00b4d8"/></w:rPr></w:lvl></w:abstractNum>'
    '<w:abstractNum w:abstractNumId="91"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/>'
    '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="480" w:hanging="320"/></w:pPr>'
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="0d2137"/></w:rPr></w:lvl></w:abstractNum>')


def build(template: Path, out: Path, pages: dict[int, str]) -> None:
    tmp = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(template) as z:
        z.extractall(tmp)
    doc = (tmp / "word/document.xml").read_text(encoding="utf-8")
    head, body = doc[:doc.find("<w:body>") + 8], doc[doc.find("<w:body>") + 8:]
    sect = body[body.rfind("<w:sectPr"):]
    if "w:gutter" not in sect:   # the template's own pgMar omits the schema-required gutter
        sect = sect.replace("<w:pgMar ", '<w:pgMar w:gutter="0" ', 1)
    items = [m.group(0) for m in re.finditer(r"<w:p[ >].*?</w:p>|<w:tbl>.*?</w:tbl>", body[:body.rfind("<w:sectPr")], re.S)]

    def swap(xml, old, new):
        assert old in xml, old
        return xml.replace(old, escape(new), 1)

    cover = items[:19]
    cover[7] = swap(cover[7], "[NAME]", "Ionity Gate^Flame")
    cover[8] = swap(cover[8], "Ionity System EDGE Computing ", "Tiers & Models")
    cover[9] = swap(cover[9], "[Title]", "Product range definition — hardware, setup, deployment and features")
    cover[10] = swap(cover[10], "[Focus area]", "Gate^Flame T1–T4 · Standard and Premium editions")
    cover[13] = swap(cover[13], "ION-POC-EDGE-2026-001  |  Version 9.0  |  15 May 2026",
                     f"{DOC_ID}  |  Version {VERSION}  |  {DATE}")

    index_intro = para(f"This document is structured into {len(SECTIONS)} sections: a short product overview, the tier layout, "
                       "one section for each of the eight models (T1–T4, Standard and Premium), then open decisions, "
                       "recommendations and the revision history.", before=80, after=80)
    idx_rows = [[str(i + 1), s["title"], pages.get(i + 1, "")] for i, s in enumerate(SECTIONS)]
    index_tbl = table(["Section", "Topic", "Page"], idx_rows, [1050, 6150, 1860])
    index_note = items[25]

    lists = Lists()
    content = []
    for i, s in enumerate(SECTIONS, 1):
        if not s.get("nobreak"):
            content.append(PAGE_BREAK)
        content.append(heading(f"{i}. {s['title']}", 1))
        content.append(render_blocks(s["blocks"], lists, i, [0]))

    new_body = "".join(cover) + items[19] + items[20] + index_intro + index_tbl + items[24] + index_note + "".join(content) + sect
    (tmp / "word/document.xml").write_text(head + new_body, encoding="utf-8")

    num = (tmp / "word/numbering.xml").read_text(encoding="utf-8")
    nums = '<w:num w:numId="90"><w:abstractNumId w:val="90"/></w:num>' + "".join(
        f'<w:num w:numId="{n}"><w:abstractNumId w:val="91"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        for n in lists.nums)
    if num.rstrip().endswith("/>") and "</w:numbering>" not in num:
        num = num.rstrip()[:-2] + ">" + NUMBERING_ADD + nums + "</w:numbering>"
    else:
        first = num.find("<w:num ")
        num = (num[:first] + NUMBERING_ADD + num[first:]) if first > 0 else num.replace("</w:numbering>", NUMBERING_ADD + "</w:numbering>")
        num = num.replace("</w:numbering>", nums + "</w:numbering>")
    (tmp / "word/numbering.xml").write_text(num, encoding="utf-8")

    # Document properties: title and author (the person who wrote it, not the template's founder line)
    core = tmp / "docProps/core.xml"
    if core.exists():
        c = core.read_text(encoding="utf-8")
        c = re.sub(r"<dc:title>.*?</dc:title>", "<dc:title>Ionity Gate^Flame - Tiers &amp; Models</dc:title>", c)
        core.write_text(c, encoding="utf-8")

    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        ct = tmp / "[Content_Types].xml"
        z.write(ct, "[Content_Types].xml")
        for f in sorted(tmp.rglob("*")):
            if f.is_file() and f != ct:
                z.write(f, f.relative_to(tmp).as_posix())
    shutil.rmtree(tmp)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default=str(REPO / "docs/templates/TEMPLATE_2026_OFFICAL_v1.1.1.docx"))
    ap.add_argument("--out", default=str(REPO / "docs/Ionity_Gate^Flame-Tiers&Models.docx"))
    ap.add_argument("--pages", default="")
    a = ap.parse_args()
    pg = {int(k): v for k, v in (x.split(":") for x in a.pages.split(",") if x)}
    build(Path(a.template), Path(a.out), pg)
    print(a.out)

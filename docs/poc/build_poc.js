const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, ImageRun, Header, Footer,
  PageNumber, NumberFormat, LevelFormat, convertInchesToTwip, VerticalAlign,
  PageBreak, ExternalHyperlink
} = require("docx");
const fs = require("fs");

const ORANGE = "E36C0A";
const DARKGREY = "222222";
const MIDGREY = "555555";
const LINEGREY = "AAAAAA";
const GREEN_ACCENT = "2E7D32";
const RED_ACCENT = "B00020";

const FONT = "Calibri";

function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: 21, ...opts })],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "poc-bullets", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 21, ...opts })],
  });
}

function numbered(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "poc-numbers", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 21, ...opts })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: ORANGE, space: 4, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text, font: FONT, bold: true, size: 28, color: DARKGREY })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, bold: true, size: 24, color: ORANGE })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 100 },
    children: [new TextRun({ text, font: FONT, bold: true, size: 22, color: DARKGREY })],
  });
}

function calloutBox(titleText, lines, accent) {
  return new Table({
    width: { size: 9350, type: WidthType.DXA },
    columnWidths: [9350],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: accent },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: accent },
      left: { style: BorderStyle.SINGLE, size: 24, color: accent },
      right: { style: BorderStyle.SINGLE, size: 4, color: accent },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9350, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F7F7F7" },
            margins: { top: 140, bottom: 140, left: 200, right: 200 },
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: titleText, bold: true, font: FONT, size: 21, color: accent })],
              }),
              ...lines.map((l) => new Paragraph({
                spacing: { after: 60 },
                children: [new TextRun({ text: l, font: FONT, size: 20, color: DARKGREY })],
              })),
            ],
          }),
        ],
      }),
    ],
  });
}

function tableFromRows(headerCells, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells.map((t, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "2B2B2B" },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", font: FONT, size: 19 })] })],
    })),
  });
  const bodyRows = rows.map((r) => new TableRow({
    children: r.map((cellDef, i) => {
      const isObj = typeof cellDef === "object" && cellDef !== null && !Array.isArray(cellDef);
      const text = isObj ? cellDef.text : cellDef;
      const bold = isObj ? !!cellDef.bold : false;
      const color = isObj ? cellDef.color || DARKGREY : DARKGREY;
      const fill = isObj ? cellDef.fill : undefined;
      return new TableCell({
        width: { size: colWidths[i], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
        margins: { top: 70, bottom: 70, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: String(text), font: FONT, size: 19, bold, color })] })],
      });
    }),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  });
}

const runningHeader = new Header({
  children: [
    new Paragraph({
      border: { bottom: { color: LINEGREY, space: 4, style: BorderStyle.SINGLE, size: 4 } },
      spacing: { after: 60 },
      children: [
        new TextRun({ text: "IONITY GLOBAL (Pty) Ltd  ", bold: true, font: FONT, size: 16, color: DARKGREY }),
        new TextRun({ text: "POL 986 AED", font: FONT, size: 16, color: MIDGREY }),
        new TextRun({ text: "   CONFIDENTIAL", bold: true, font: FONT, size: 16, color: RED_ACCENT }),
      ],
    }),
  ],
});

const runningFooter = new Footer({
  children: [
    new Paragraph({
      border: { top: { color: LINEGREY, space: 4, style: BorderStyle.SINGLE, size: 4 } },
      tabStops: [{ type: "right", position: 9350 }],
      children: [
        new TextRun({ text: "www.ionity.today | ai@ionity.today  RULES 991", font: FONT, size: 16, color: MIDGREY }),
        new TextRun({ text: "\t", font: FONT }),
        new TextRun({ text: "Page ", font: FONT, size: 16, color: MIDGREY }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MIDGREY }),
        new TextRun({ text: " of ", font: FONT, size: 16, color: MIDGREY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: MIDGREY }),
      ],
    }),
  ],
});

const prototypePhoto = fs.readFileSync("/tmp/poc_assets2/prototype_photo.jpg");
const caseCad = fs.readFileSync("/tmp/poc_assets2/case_cad.jpg");

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "poc-bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }],
      },
      {
        reference: "poc-numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 260 } } } }],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 },
        },
      },
      headers: { default: runningHeader },
      footers: { default: runningFooter },
      children: [
        // ---------------- TITLE BLOCK ----------------
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 200, after: 40 },
          children: [new TextRun({ text: "IONITY GLOBAL (Pty) Ltd", bold: true, font: FONT, size: 22, color: DARKGREY })],
        }),
        new Paragraph({
          spacing: { after: 300 },
          children: [new TextRun({ text: "Dennis Grobler", font: FONT, size: 20, color: MIDGREY, italics: true })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: "Gate^Flame Standard Edition", bold: true, font: FONT, size: 40, color: ORANGE })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: "Proof of Concept — Deployment & Evaluation Framework", font: FONT, size: 26, color: DARKGREY })],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: "Hardware Reference Design Rev. A — Radxa Cubie A7A-6GB", font: FONT, size: 21, italics: true, color: MIDGREY })],
        }),
        new Paragraph({
          spacing: { after: 400 },
          border: { bottom: { color: LINEGREY, space: 8, style: BorderStyle.SINGLE, size: 6 } },
          children: [
            new TextRun({ text: "ION-POC-GF-2026-003 | Version 0.5 (Draft) | 31 Aug 2026", font: FONT, size: 19, color: MIDGREY }),
          ],
        }),
        calloutBox("CONFIDENTIAL", [
          "www.ionity.today | ai@ionity.today",
          "This document supersedes, on hardware, the Standard Edition figure stated in ION-POC-GF-2026-001 (v1.0) — see §12.1.",
          "v0.2 adds operational scope: roles & escalation (§7), telemetry (§8), security & data handling (§9), and the post-PoC transition plan (§11).",
          "v0.3 fixes the standard-tier subscription fee at R49/month (first month free) in §11.2 — the commercial path is otherwise unchanged.",
          "v0.5 CORRECTS §9.2. Per-device Shield state (device name and hardware address) now leaves the LAN. Earlier versions of this document told a prospective client the opposite. Read §9.2 before this document goes to anyone.",
          "v0.5 also adds §4.3 Gate\u005eFlame Shield, §4.4 guided assistance, §4.5 the operator console, and real measured figures in §8.1.1.",
        ], RED_ACCENT),

        new Paragraph({ children: [new PageBreak()] }),

        // ---------------- 1. EXECUTIVE SUMMARY ----------------
        h1("1. Executive Summary"),
        bodyPara(
          "This document defines the framework for a formal Proof of Concept (PoC) deployment of the Gate^Flame Security Node, Standard Edition. The objective is to demonstrate Gate^Flame's ability to integrate into an existing network as an out-of-band DNS resolver, neutralise Layer 7 threats and telemetry payloads, and provide network visibility — all without touching the household's top-line routing speed."
        ),
        bodyPara(
          "The Standard Edition is a side-car appliance: it never sits in the traffic path. Household throughput is bound only by the ISP connection, never by this device. If the node loses power, the router falls back to its own upstream DNS automatically — there is no scenario in which this appliance can take a household offline.",
          { italics: true, color: MIDGREY }
        ),
        bodyPara(
          "This revision (v0.1) updates the reference hardware from the figure published in ION-POC-GF-2026-001 to the Radxa Cubie A7A-6GB, following a cost-driven hardware decision (§5.5), and documents the physical enclosure already fabricated for this build (§5.2)."
        ),

        // ---------------- 2. SCOPE ----------------
        h1("2. Scope & Target Environment"),
        bullet("Duration: 14 Days"),
        bullet("Hardware Tier: Standard (Side-Car)"),
        bullet("Target Network: One VLAN (e.g. Management or Corporate Wi-Fi) or whole-site deployment, depending on the client's risk appetite."),
        bullet("Deployment Method: Zero-touch DNS redirection. The existing router's upstream/WAN DNS is re-pointed to the Gate^Flame node. DHCP and physical routing are left untouched, guaranteeing a fail-safe fallback (ADR-001)."),

        // ---------------- 3. SUCCESS CRITERIA ----------------
        h1("3. Success Criteria"),
        bodyPara("To convert this PoC into a paid deployment, Gate^Flame must meet the following measurable objectives inside the 14-day window:"),
        tableFromRows(
          ["#", "Objective", "Pass Bar", "Method"],
          [
            ["1", "Traffic Optimisation", "20-40% reduction in total DNS queries", "Pi-hole query log, pre/post comparison"],
            ["2", "Threat Mitigation", "Known-malicious domains sinkholed; full Threat Log produced", "SOC dashboard export"],
            ["3", "Zero Throughput Impact", "Line-rate up/down and latency unchanged", "Speed test, pre/post, same time-of-day"],
            ["4", "Operational Stability (Fail-Open)", "Simulated power loss -> router reverts to ISP DNS within seconds, zero permanent downtime", "Pull power at the node, time to recovery"],
          ],
          [700, 3000, 3650, 2000]
        ),

        // ---------------- 4. ARCHITECTURE ----------------
        h1("4. Product Architecture - Standard Edition"),
        bodyPara("Source: Ionity Global (Pty) Ltd, Gate^Flame Standard Edition Product Capabilities, ION-POC-GF-2026-001 v1.0, 28 Aug 2026.", { italics: true, size: 18, color: MIDGREY }),
        h3("4.1 The “Side-Car” Guarantee"),
        bodyPara("Unlike in-line appliances that sit in the traffic path, the Standard Edition operates out-of-band as an upstream DNS resolver."),
        bullet("Zero impact on line speed: household traffic never physically routes through the device. The box only handles DNS queries."),
        bullet("Fail-safe design: if the device loses power, the network does not go down - the router falls back to its default configuration."),
        h3("4.2 Capabilities & Features"),
        bullet("Network-Wide Threat Blocking (Pi-hole): neutralises ads, trackers, malware domains, and telemetry across every connected device, including smart TVs and IoT devices that cannot run antivirus software."),
        bullet("Sovereign Resolution (Unbound): queries resolve directly against root servers - browsing data is never handed to a third-party resolver."),
        bullet("Automated Network Healing: the onboard netclaim engine detects and heals configuration faults (e.g. suppressing broken IPv6 routes that drop phones off Wi-Fi)."),
        bullet("Privacy-First Telemetry: POPIA-driven. Threat logs, client IP addresses and the domains anyone visited never leave the LAN - the outbound code does not import them at all. Support feeds carry hardware health, module state, and - only for devices the household has put on a VPN region - that device's name and hardware address. §9.2 states the full boundary; do not quote this bullet without it."),
        h3("4.3 Gate^Flame Shield - per-device VPN"),
        bodyPara("Added since v0.4 and running on the prototype. The household picks a device, then a country; that device's traffic exits in the chosen region while every other device is untouched. It is per-device by design - a household should not have to put the whole house in Japan so one person can watch something."),
        bullet("Live on the prototype at the time of writing: 8 countries across 99 servers, with a continent shortcut (\u201cAsia\u201d) so nobody has to choose between fifteen individual countries."),
        bullet("Devices are named by their owner and the same name appears on the phone, the wall console and in support - so a customer and a support agent are never describing two different devices to each other."),
        bullet("The connection profile is fetched fresh on demand and handed to the phone's own VPN app. Nothing is cached, because the underlying server list genuinely rotates."),
        calloutBox("State this accurately to a client", [
          "Shield currently runs entirely on VPN Gate, a volunteer-operated public pool. Its countries come and go: the eight available on the prototype this afternoon were not the eight available that morning.",
          "Ionity-operated exit servers are designed and NOT built. Do not present Shield as an Ionity VPN service - present it as a per-device country picker that today rides a free public pool, with our own exits as roadmap.",
        ], RED_ACCENT),
        h3("4.4 Guided assistance, on the phone and on the wall"),
        bodyPara("A built-in assistant diagnoses the household's own network - five checks, seven distinct outcomes - and walks the owner through the fix in plain language, rather than presenting an error code. It runs on both the phone app and the wall console."),
        bodyPara("The wall console is the more useful of the two, and deliberately so: its checks run on the appliance itself, so they still answer when the household's Wi-Fi is the thing that is broken. A phone asking the network about the network is least reachable exactly when it is most needed."),
        h3("4.5 Operator console (Ionity-side, not client-facing)"),
        bodyPara("Every deployed box reports its own health outward on a fixed interval to a console Ionity runs. This is what makes a support call start with information rather than questions."),
        bullet("Fleet health: which boxes are online, their temperature and load, and which software modules are running on each."),
        bullet("Support view: turns what a box reported into what is wrong, what the customer will notice, and what to check - and names the field each conclusion came from, so a support agent can tell a measurement from an inference."),
        bullet("Each box authenticates with its own credential rather than a shared secret, so one unit cannot report as another."),
        bodyPara("The console reads what boxes send. It cannot reach into a customer's box - remote support access is roadmap, not a current capability (§12.4)."),
        h3("4.6 Deliberately Capped, Not Under-Powered"),
        bodyPara("The Standard tier is capped in software at the OFFER tier (netclaim.Capabilities.max_tier) regardless of what the underlying hardware could do. This holds even on the Cubie A7A-6GB, which is materially more capable than the Standard tier ever exercises - capability is not permission. The Premium tier (In-Line Sentinel, separate hardware, DPI/SIEM/AI heuristics) is out of scope for this PoC."),

        // ---------------- 5. HARDWARE ----------------
        h1("5. Hardware Reference Design"),
        h3("5.1 Prototype"),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new ImageRun({ data: prototypePhoto, type: "jpg", transformation: { width: 320, height: 320 } })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "Fig. 1 - Assembled Gate^Flame Standard Edition enclosure, active-cooled, printed and badged.", italics: true, font: FONT, size: 18, color: MIDGREY })],
        }),

        h3("5.2 Enclosure - “Exo-Mesh” Design"),
        bodyPara("Source file: GateFlame_Design_0.1.scad (OpenSCAD, parametric). Client: Ionity Global PTY. Dated 29 Aug 2026."),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new ImageRun({ data: caseCad, type: "jpg", transformation: { width: 460, height: 256 } })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "Fig. 2 - Two-part base + hex-mesh lid, as modelled in OpenSCAD.", italics: true, font: FONT, size: 18, color: MIDGREY })],
        }),
        bodyPara("As-designed parameters (from the source file):"),
        tableFromRows(
          ["Parameter", "Value", "Note"],
          [
            ["Wall thickness", "2.5 mm", "wall"],
            ["Internal board envelope", "88 x 59 mm", "int_len x int_wid - 85x56mm board + tolerance"],
            ["Internal height (bottom shell)", "12 mm", "int_ht_bottom"],
            ["Internal height (lid)", "22 mm", "int_ht_top - sized for an active cooler/fan stack"],
            ["Mounting hole spacing", "58 x 49 mm", "pi_mount_x x pi_mount_y"],
            ["Standoff height / diameter", "4 mm / 6 mm", "standoff_h / standoff_d"],
            ["Screw clearance hole", "2.4 mm", "screw_hole_d - spec'd for M2.5 screws"],
            ["External footprint", "93 x 64 mm", "derived: internal + 2x wall"],
          ],
          [3200, 2400, 3750]
        ),

        h3("5.3 Fit-Check - Cubie A7A-6GB Against the As-Built Case"),
        bodyPara("The enclosure above was dimensioned against a 85x56mm board on a 58x49mm mounting pattern - the Raspberry Pi 5 standard. Checked against Radxa's published mechanical drawing for the Cubie A7A (RAD-DOC-0155 Rev 1.1):"),
        tableFromRows(
          ["Dimension", "Case is cut for", "Cubie A7A-6GB actual", "Result"],
          [
            ["Board outline", "85 x 56 mm", "85 x 56 mm", { text: "Exact match", color: GREEN_ACCENT, bold: true }],
            ["Mounting hole spacing", "58 x 49 mm", "58 x 49 mm", { text: "Exact match", color: GREEN_ACCENT, bold: true }],
            ["Mounting hole diameter", "2.4 mm (case-side clearance)", "4x Ø2.7 mm (board-side)", { text: "Verify in hand", color: "B8860B", bold: true }],
            ["Port cutouts (side wall)", "Single placeholder cutout, Pi5 layout", "1x HDMI, 1x USB-C, 1x USB3.1-A, 3x USB2-A, 1x GbE, audio jack, uSD, Wi-Fi antenna", { text: "Needs revision", color: RED_ACCENT, bold: true }],
            ["Fan/cooler", "Centred top grille, sized for Pi5 Active Cooler", "Board ships with its own heatsink+fan on a 2-pin PWM header", { text: "Needs revision", color: RED_ACCENT, bold: true }],
          ],
          [2000, 2600, 3000, 1750]
        ),
        bodyPara(""),
        calloutBox("Good news: no case redesign needed on the two dimensions that matter most", [
          "The board outline (85x56mm) and the 4-hole 58x49mm mounting pattern are identical between the Raspberry Pi 5 and the Cubie A7A-6GB - confirmed against Radxa's own mechanical drawing, not assumed. The existing printed shell and standoff layout carry over directly.",
        ], GREEN_ACCENT),
        bodyPara(""),
        calloutBox("Open before this unit ships as the PoC device", [
          "1. Fan header: the fan currently mounted is almost certainly wired for a genuine Raspberry Pi 5 Active Cooler (proprietary FPC connector). The Cubie A7A's bundled heatsink+fan uses a generic 2-pin PWM header - confirm which fan is actually in the box before first power-on, and rewire/replace if it's the Pi5 unit.",
          "2. Side-wall port cutouts are a single placeholder in the current .scad (“Example Port Cutout”) sized loosely for the Pi5's 2x micro-HDMI / USB-C / 2x USB3 / 2x USB2 stack. The Cubie A7A's connector stack is a different shape and, per the mechanical drawing, sits roughly 47.3mm from the left edge along a ~22.1mm vertical span on the same wall - close enough to reuse the wall, not the cutout. Needs a caliper check against the physical board before the next print.",
          "3. Mounting screw fit: case-side clearance is cut at 2.4mm for M2.5; Radxa specs the board's own holes at Ø2.7mm. These serve different jobs (case standoff vs. board through-hole) and are very likely fine together, but haven't been confirmed on the actual board yet.",
        ], "B8860B"),

        h3("5.4 Bill of Materials - Standard Edition (Cubie A7A-6GB build)"),
        bodyPara("Pricing live-checked 30 Aug 2026, South African retail, ZAR, 15% VAT.", { italics: true, size: 18, color: MIDGREY }),
        tableFromRows(
          ["Qty", "Item", "Supplier / Part No.", "Ex VAT", "Inc VAT", "Note"],
          [
            ["1", "Radxa Cubie A7A 6GB LPDDR5 Wi-Fi 6 Dev Board", "robotics.org.za - CUBIE-A7A-6GB", "R1,188.00", "R1,366.20", "In stock, Centurion + Stellenbosch. Ships with Radxa heatsink+fan."],
            ["1", "USB-C 5V/4A (20W) AC Adapter w/ Switch, CE approved", "robotics.org.za - XSG-0504000HEU", "R128.00", "R147.20", "In stock. Meets Radxa's suggested 3.5A and its '20W under full peripheral load' guidance with headroom - no caveat needed."],
            ["1", "Hiksemi Neo 32GB Class 10 MicroSDHC", "robotics.org.za - HS-TF-C1-32G", "R168.00", "R193.20", "In stock. OS boot media (Debian-based)."],
            ["1", "Enclosure - “Exo-Mesh” two-part 3D print", "In-house, GateFlame_Design_0.1.scad", "TBD", "TBD", "Material + print-time cost not yet logged."],
            ["4", "M2.5 brass standoffs + screws", "Existing stock", "-", "-", "No new line item unless case screw diameter is revised (§5.3)."],
          ],
          [500, 3000, 2600, 1300, 1300, 1650]
        ),
        bodyPara(""),
        tableFromRows(
          ["", "Ex VAT", "Inc VAT"],
          [[{ text: "Bought-in subtotal (board + PSU + storage)", bold: true }, { text: "R1,484.00", bold: true }, { text: "R1,706.60", bold: true }]],
          [4500, 2350, 2500]
        ),

        h3("5.5 Hardware Selection Rationale"),
        bodyPara("The Standard tier target moved from a Raspberry Pi 5 to the Cubie A7A-6GB on cost. A Pi 5 16GB board alone runs R5,899.90 (pishop.co.za) before a PSU or active cooler; the Cubie A7A-6GB lands the board, Wi-Fi 6, gigabit Ethernet, a 40-pin Pi-compatible GPIO header, and a bundled heatsink+fan at R1,188.00 ex VAT - while still carrying a 3 TOPS NPU and PCIe 3.0 headroom the Standard tier doesn't even use (§4.6). For a side-car role capped at DNS resolution, ad-blocking, and light healing logic, that is comfortable headroom at roughly a fifth of the Pi 5's board cost."),

        // ---------------- 6. TIMELINE ----------------
        h1("6. Timeline & Milestones"),
        tableFromRows(
          ["Day", "Milestone", "Activities"],
          [
            ["1", "Provisioning & Handshake", "Physical installation of the node. Automated router handshake. Pairing of the administrator's mobile device."],
            ["3", "Baseline Tuning", "Review initial threat logs and blocked domains. Whitelist any internal legacy services relying on blocked telemetry."],
            ["7", "Mid-Point Review", "Export the first week's telemetry summary. Demonstrate the live dashboard and threat heuristics. Conduct the fail-open power-loss test."],
            ["14", "Final Reporting & Sign-Off", "Present the final 14-day Network Health & Threat Report. Client sign-off on success criteria. Transition from PoC to active subscription."],
          ],
          [700, 2650, 6000]
        ),

        // ---------------- 7. ROLES & ESCALATION ----------------
        h1("7. Roles, Responsibilities & Support Escalation"),
        h3("7.1 Day-to-Day Ownership"),
        bullet("PoC technical owner: Dennis Grobler, Ionity Global (Pty) Ltd — sole point of contact for installation, tuning, and troubleshooting for the duration of this PoC."),
        bullet("Client liaison: [client to nominate] — the single named contact authorised to approve whitelist changes, schedule the Day 7 fail-open test, and sign off at Day 14."),
        bodyPara("This is a single-operator engagement model, not a staffed help desk — stated here deliberately rather than implied. There is no 24/7 support line or ticketing system behind this PoC yet. What backstops that is architectural, not organisational: the fail-open guarantee (§10) means a delay in human response never becomes a network outage."),
        h3("7.2 Incident Definitions & Response Targets (proposed — confirm before Day 1)"),
        tableFromRows(
          ["Severity", "Trigger", "Target first response"],
          [
            ["SEV-1", "Side-Car guarantee breached: node begins passing/blocking live traffic instead of DNS-only, or any household throughput drop is attributable to the node", "Same business day — target 4 business hours"],
            ["SEV-2", "Node offline or hardware fault: Cubie A7A-6GB unresponsive, or a power failure outlasts the fail-open window", "1 business day"],
            ["SEV-3", "Filtering issue: a legitimate service is wrongly blocked (false positive)", "Next business day — folded into Day 3 / Day 7 tuning"],
          ],
          [1200, 5900, 2250]
        ),
        bodyPara("These are proposed defaults for a 14-day engagement, not an existing support contract. Confirm them with the client before Day 1 if the PoC is being sold on the strength of a specific response time.", { italics: true, color: MIDGREY }),

        // ---------------- 8. FEEDBACK & TELEMETRY ----------------
        h1("8. Feedback Mechanism & Telemetry"),
        bodyPara("Each Success Criterion (§3) is measured by a different mechanism — some automated, some manual. Conflating the two when reporting results is the easiest way to make a result look more rigorous than it is."),
        tableFromRows(
          ["#", "Criterion", "Data source", "Automated / Manual"],
          [
            ["1", "Traffic Optimisation", "Pi-hole query log, exported pre/post", "Automated (existing)"],
            ["2", "Threat Mitigation", "Pi-hole admin dashboard block/threat log", "Automated (existing)"],
            ["3", "Zero Throughput Impact", "Speed test run pre- and post-install, same time of day", "Manual"],
            ["4", "Operational Stability (Fail-Open)", "Timed power-pull test, Day 7", "Manual"],
          ],
          [500, 2800, 3900, 2150]
        ),
        h3("8.1.1 The measurement chain already works - figures from the prototype"),
        bodyPara("The table above describes how each criterion will be measured during a client PoC. On the engineering prototype that chain is already producing figures, which is worth stating because it means Day 1 is not also the first test of the instrumentation itself. Read live from node GF-72TYTITQ on 31 Aug 2026, over 6 h 44 m of uptime:"),
        tableFromRows(
          ["Reading", "Value", "Note"],
          [
            ["DNS lookups answered", "41 274", "from 11 devices"],
            ["Refused", "5 164", "12.5% of all lookups"],
            ["Blocklist size", "425 410 domains", "at the SAFEST of three threat levels"],
            ["Rate", "~6 100 / hour", "~760 refused per hour"],
          ],
          [3000, 2400, 3950]
        ),
        bodyPara("These are one engineering household over part of one day, not a benchmark and not a client result. They are included to show the reporting path is real - the same counters the Day 14 report will draw on. Note the block rate was achieved at the LOW threat level, which loads three block-lists; the product offers up to nine.", { italics: true, color: MIDGREY }),

        h3("8.2 Hardware Health Telemetry"),
        bodyPara("Per the Standard Edition's privacy-first design, the only telemetry that leaves the LAN during the PoC is hardware health — CPU load and thermals — used solely to confirm the node itself is healthy. gateflame-memcheck.sh is the tool that measures memory headroom against the device's budget; it has not yet been run against this specific Cubie A7A-6GB build (§12.3), so treat Days 1–3 as also a hardware burn-in check, not just a network one."),
        h3("8.3 Qualitative Feedback"),
        bodyPara("Bug reports and “this got blocked and shouldn't have been” notes from anyone on the target network go to the client liaison (§7.1), who forwards them to the PoC owner — a shared note or short daily message is enough; no ticketing system is being stood up for a 14-day test. These feed directly into the Day 3 whitelist review and the Day 7 mid-point tuning pass."),

        // ---------------- 9. SECURITY & DATA HANDLING ----------------
        h1("9. Security, Compliance & Data Handling"),
        h3("9.1 Live Data, Not Synthetic"),
        bodyPara("This PoC runs against the target network's real, live DNS traffic for the full 14 days — not a synthetic or sandboxed dataset. That is the point: the traffic-reduction and threat-mitigation figures in §3 are only meaningful if measured against what the household or business actually queries. The client should go into the PoC aware of this, even though the privacy boundary below limits what that exposure actually means in practice."),
        h3("9.2 What Leaves the LAN, and What Doesn't"),
        calloutBox("CHANGED IN v0.5 - READ BEFORE ISSUING", [
          "Versions 0.1-0.4 of this document stated that only hardware health leaves the LAN. That is no longer true, and a client who was shown an earlier version has been told something this product no longer does.",
          "Gate^Flame Shield (§4.3) reports per-device state so that support can answer \u201cwhich of my devices is on Japan?\u201d without asking the customer to read a screen aloud. That report carries the device's name and hardware address.",
        ], RED_ACCENT),
        bodyPara("Stated plainly, and in the order a client should read it:"),
        bullet("Never leaves the LAN: DNS query logs, the domains anyone visited, client IP addresses, and this network's block-list activity. These are not merely filtered out at the point of sending - the code that builds the outbound report does not import them at all, so a future change cannot wire one in by accident."),
        bullet("Leaves the LAN, to Ionity only, for support: device hardware health - processor load, memory, storage, temperature - and the running state of each software module."),
        bullet("Leaves the LAN, to Ionity only, for support, ONLY for devices the household has put on a VPN region: that device's hardware (MAC) address, the name the owner gave it, the region chosen, and whether it is currently on. A household that never uses Shield sends none of this."),
        bodyPara("What that means in practice: Ionity can see that a device the owner called \u201cKyle's tablet\u201d is set to Japan. Ionity cannot see a single site that tablet visited, nor which devices made which requests - per-client attribution is architecturally absent on the standard tier anyway (§12.2)."),
        h3("9.2.1 Consequences that must be closed before first sale"),
        bullet("The customer-facing privacy notice must state that device identifiers are collected. POPIA s18 requires this; it is not optional and it is not covered by the general telemetry wording."),
        bullet("The Google Play data-safety declaration must declare device identifiers. The honest answer to that form was previously unusually strong - almost nothing left the LAN - and it remains strong, but it is no longer \u201cnothing.\u201d Filing the old answer would be a false declaration to Google."),
        bodyPara("Both are tracked as blocking items for the first Play upload (§12.4). Neither affects the PoC itself, which runs before any store listing exists - but a client asking \u201cwhat do you send?\u201d during the PoC must get the answer above, not the one in v0.4."),
        bodyPara("This remains a POPIA-driven design (ION-POC-GF-2026-001, \u201cPrivacy-First Telemetry\u201d); the boundary has moved once, deliberately and narrowly, and is documented rather than quietly widened."),
        h3("9.3 Applicable Compliance"),
        bullet("POPIA (Protection of Personal Information Act) is the operative regime for a South African deployment, and the one this design is built against."),
        bullet("GDPR is out of scope for this PoC unless the client confirms EU-resident data subjects are on the target network — do not present GDPR compliance as a blanket claim without checking that first."),
        h3("9.4 Access & Administration During the PoC"),
        bullet("Router credentials are never collected, stored, or transmitted to Ionity Global — the upstream-DNS handshake is a guided, one-screen manual step performed by whoever is on-site (ADR-001; no credentialed auto-login exists or is planned)."),
        bullet("Administrative access to the Gate^Flame node itself (for tuning, log review) is via direct SSH from Dennis Grobler's own equipment only — there is no client-facing admin portal at this stage."),
        h3("9.5 Data Retention & Destruction (proposed default — confirm)"),
        bodyPara("Recommended default: logs remain on the device for the duration of the PoC and are used only to generate the Day 14 report, then are purged from the unit at decommission or hand-back unless the client requests they be retained for their own records. This is a proposed default, not an existing written policy — confirm before Day 1 if the client has specific retention requirements."),

        // ---------------- 10. REVERSIBILITY ----------------
        h1("10. Reversibility Guarantee"),
        bodyPara("This PoC is strictly non-destructive. If terminated at any point, reverting the network requires a single change: switching the router's upstream DNS back to “Automatic”. The Gate^Flame node leaves no permanent footprint on the client's infrastructure."),

        // ---------------- 11. POST-POC TRANSITION ----------------
        h1("11. Post-PoC Transition — The Day-After Plan"),
        bodyPara("§10 covers what happens if this PoC is terminated early or fails. This section covers what happens if it succeeds — the case the framework's Day 14 milestone calls “transition from PoC to active subscription” (§6), made concrete."),
        h3("11.1 Hardware Path"),
        bodyPara("The unit used for this PoC is a pre-production engineering prototype, not a finalised retail build — §12 lists what is still open on the case (fan header connector, side-wall port cutouts) even though the core board fit is confirmed (§5.3). Recommended path on a successful sign-off:"),
        numbered("Leave the PoC unit running in place as an interim/active unit immediately at sign-off — there is no reason to create a service gap by pulling a working node."),
        numbered("Fabricate and validate a second unit that closes out the open items in §12 (fan header, port cutouts, screw-fit confirmation)."),
        numbered("Swap to the finalised unit on an agreed date, using the same reversible DNS-repoint mechanism as §10 in reverse — a planned cutover the client knows about in advance, not an invisible one."),
        h3("11.2 Commercial Path"),
        bodyPara("Decided 2026-08-31: the standard-tier subscription is R49/month, with the first month free as an introductory promotion. That fixes the fee - it does not yet fix the billing start date, or whether the hardware itself is sold, leased, or remains Ionity-owned equipment on a service contract. Settle those before Day 14, not during the sign-off conversation itself."),
        bodyPara("This fee is for support, monitoring and updates - never a gate on the DNS filtering itself. Per ADR-001 and the health-feed design (PAIRING-AND-TELEMETRY.md §4.3), protection keeps working whether or not a unit is current on billing; non-payment is a commercial matter handled through the sale agreement, not a remote kill switch on a household's filtering."),

        // ---------------- 12. OPEN ITEMS ----------------
        h1("12. Open Items & Engineering Caveats"),
        h3("12.1 Hardware figure in ION-POC-GF-2026-001 is stale"),
        calloutBox("Needs a decision", [
          "The published Standard Edition Product Capabilities sheet (ION-POC-GF-2026-001 v1.0, 28 Aug 2026) states “Base Model: Orange Pi Zero 2W, 2GB RAM.” This PoC is built and BOM'd against the Radxa Cubie A7A-6GB instead. Recommend issuing a v1.1 correction to -001, or an explicit addendum, before either document goes to a client - a prospect who reads both should not see two different appliances.",
        ], RED_ACCENT),
        h3("12.2 Accepted limitations, by design (ADR-001)"),
        bullet("Filtering is not 100%: the router will sometimes use its own upstream instead of Gate^Flame."),
        bullet("Per-client attribution is lost: Pi-hole sees the router's address, not each device individually. PoC reporting and kiosk copy should say “N devices protected,” never attribute a block to a specific device or person."),
        bullet("Router upstream-DNS handshake is a guided, one-screen manual step - there is no credentialed auto-login built for arbitrary routers, and none is planned (see router_adapters.py)."),
        h3("12.3 Not yet validated on this hardware"),
        bullet("Fail-open power-loss behaviour (Success Criterion 4) has not yet been run against the Cubie A7A-6GB build - it is scheduled as the Day 7 milestone above, not a pre-confirmed result."),
        bullet("gateflame-memcheck.sh has not yet been run against this board to confirm memory headroom under the 2GB-class budget the code currently grades against."),
        bullet("The RA advertiser and dual-homing fixes described in the project's engineering state notes are written and syntax-checked but not yet deployed to any field unit."),

        h3("12.4 Blocking items between here and a paying customer"),
        bodyPara("These do not affect the PoC, which runs before any store listing exists. They do affect the day after a successful sign-off, and §11.2 promises a subscription that cannot start until they are closed."),
        tableFromRows(
          ["What", "Blocks", "Why it is open"],
          [
            ["Privacy notice + Play data-safety declaration",
             "First Play upload",
             "Device identifiers now leave the LAN (§9.2). POPIA s18 and Google's data-safety form both require this to be declared."],
            ["Signed release build",
             "First Play upload",
             "The signing key exists but has never been wired into the build, so a release APK cannot be signed today. Play App Signing must be enrolled at first upload - it is the only recovery path if the key is lost."],
            ["Guided router step",
             "First unattended install",
             "The upstream-DNS change is still made by hand. A customer needs one screen that makes the change and then re-reads the router to prove it took (a router that reports \u201csaved\u201d without saving has already cost this project days)."],
            ["A second unit",
             "Any claim about scale",
             "Everything in this document is measured on one appliance. The operator console is built for hundreds and has never seen two."],
            ["Ionity-operated VPN exits",
             "Selling Shield as a service",
             "Shield rides a volunteer public pool today (§4.3)."],
            ["Remote support access",
             "Support SLAs in §7",
             "The console reads what a box reports and cannot reach into one. A persistent per-box tunnel is the agreed direction and is not built."],
          ],
          [2700, 1900, 4750]
        ),

        // ---------------- 13. SIGN-OFF ----------------
        h1("13. Sign-Off"),
        tableFromRows(
          ["Role", "Name", "Signature", "Date"],
          [
            ["Prepared by", "Dennis Grobler - Ionity Global (Pty) Ltd", "", ""],
            ["Client approval", "", "", ""],
          ],
          [2200, 3400, 2100, 1650]
        ),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/tmp/GateFlame_PoC_Standard_v0.5.docx", buf);
  console.log("written");
});

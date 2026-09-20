"""
Convert every .md in E:\\Gateflame\\docs to .docx, in the AEDI house style.

ON THE TEMPLATE
The org standard is TEMPLATE_2026_OFFICAL_v1.1.docx, which is not on this
machine (searched; not found). Rather than invent a look, this uses an
EXISTING approved document from the same folder as pandoc's --reference-doc:
1-GateFlame-Status-Report-2026-08-24.docx. That file was produced from the
template, so it carries the real thing:

    header : IONITY GLOBAL (Pty) Ltd · POL 986 AED · CONFIDENTIAL
    footer : logo + www.ionity.today | ai@ionity.today | RULES 991 | Page X of Y
    fonts  : Arial / Georgia
    styles : Title, Subtitle, Heading 1-6, Table

Every converted document inherits all of that. If the real template turns up,
point REFERENCE at it and re-run - nothing else changes.

ON AUTHORSHIP
The author written into each file's document properties is taken from that
document's OWN banner ("Author: ..."), never guessed. Documents whose banner
names Johan Wilhelm van Antwerp keep him; documents authored by Dennis keep
Dennis. Where a file states no author, the field is left empty rather than
filled with an assumption.
"""

import re
import subprocess
import sys
from pathlib import Path

DOCS = Path(r"E:\Gateflame\docs")
OUT = DOCS / "docx"
REFERENCE = DOCS / "1-GateFlame-Status-Report-2026-08-24.docx"

ORG = "Ionity (Pty) Ltd | AEDI"


def banner_field(text: str, field: str) -> str | None:
    """Pull a 'Field: value' line out of the document's own header block."""
    m = re.search(rf"^{field}:\s*(.+)$", text, re.M | re.I)
    if not m:
        return None
    # The banner packs several fields on one line with | separators.
    return m.group(1).split("|")[0].strip()


def title_of(text: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, re.M)
    if m:
        return re.sub(r"[#*`]", "", m.group(1)).strip()
    return fallback


def main() -> int:
    if not REFERENCE.exists():
        print(f"reference doc missing: {REFERENCE}")
        return 1
    OUT.mkdir(exist_ok=True)

    mds = sorted(DOCS.glob("*.md"))
    print(f"converting {len(mds)} markdown files -> {OUT}\n")
    ok = fail = 0

    for md in mds:
        text = md.read_text(encoding="utf-8", errors="replace")
        title = title_of(text, md.stem)
        author = banner_field(text, "Author") or ""
        dest = OUT / (md.stem + ".docx")

        cmd = [
            "pandoc", str(md),
            "-f", "gfm+pipe_tables+task_lists",
            "-t", "docx",
            f"--reference-doc={REFERENCE}",
            "-o", str(dest),
            "--metadata", f"title={title}",
            "--metadata", f"author={author}",
            "--metadata", f"subject={ORG}",
        ]
        # A table of contents only where there is enough structure for one to
        # help. On a short reference file it is noise.
        if len(re.findall(r"^#{1,3}\s", text, re.M)) >= 6:
            cmd += ["--toc", "--toc-depth=3"]

        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            # Read back rather than trusting the exit code.
            print(f"  [ OK ] {dest.name:<58} {dest.stat().st_size:>8,} bytes")
            ok += 1
        else:
            print(f"  [FAIL] {md.name}: {(r.stderr or 'no output file').strip()[:160]}")
            fail += 1

    print(f"\n  {ok} converted, {fail} failed")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

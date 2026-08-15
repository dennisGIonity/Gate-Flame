"""module_zero_trust — read-only security posture audit.

────────────────────────────────────────────────────────────────────────────
WHY THIS FILE IS WRITTEN THE WAY IT IS
────────────────────────────────────────────────────────────────────────────
THIS MODULE NEVER CHANGES THE HOST. Not sshd_config, not a file mode, not a
unit file. Auditing and remediating are different products with different
blast radii: an audit that is wrong prints a wrong sentence, while a
remediator that is wrong locks the customer out of their own Pi over SSH from
another country. Every finding therefore carries a `remedy` the operator runs
themselves, and there is no code path in this file that opens a file for
writing, spawns a process, or touches the network. `test_posture.py` asserts
that at the source level so a future edit cannot quietly add one.

HONESTY. A check that cannot reach its evidence produces a GAP, not a pass.
"I could not read /etc/shadow" must never render as "no weak passwords" — a
clean bill of health from a blind check is worse than no check, because the
customer stops looking. Findings and gaps are returned as two separate lists
for exactly this reason.

STRUCTURE. `evaluate(facts)` is a pure function from a `HostFacts` value to
findings; `collect(reader, ...)` is the only place that touches a filesystem,
and it goes through an injectable reader. Tests build synthetic hosts as a
dict of paths and drive both halves without root, without a Pi, and without a
network — the same seam discipline as `firewall.py`.

────────────────────────────────────────────────────────────────────────────
LIMITS OF THE sshd_config PARSE — READ THIS BEFORE TRUSTING A FINDING
────────────────────────────────────────────────────────────────────────────
* OpenSSH uses FIRST-MATCH-WINS, not last. For each keyword the *first* value
  obtained is used and later ones are ignored. This is the opposite of most
  config formats and is the single most common way a hand-written audit gets
  the answer backwards, so it is implemented explicitly in `_first_wins`.
* `Include` is expanded AT THE POINT IT APPEARS. Debian and Raspberry Pi OS
  ship `Include /etc/ssh/sshd_config.d/*.conf` as the first line, which is
  precisely why include-awareness is not optional: a drop-in there beats
  everything in the main file. Files are spliced in glob order, as sshd does.
* Nested includes (an Include inside an included file) are NOT followed. If
  one is seen, a gap is emitted naming the file rather than silently reporting
  a value that a deeper file may override.
* `Match` blocks are NOT evaluated. Everything after the first `Match` is
  conditional on user/group/address/etc., and deciding whether it applies
  would require knowing who is connecting from where. This module reports the
  GLOBAL policy only, and emits a gap listing the Match conditions present so
  the operator knows the effective policy for those cases may differ.
* We report the file's policy, not the running daemon's. A daemon that has not
  been reloaded since the file changed is still enforcing the old policy;
  confirming that would require querying the process, which is out of scope
  for a read-only file audit.
* Where a keyword is absent we state OpenSSH's documented compiled default and
  mark the finding as resting on that default rather than on an observed line.
"""

from __future__ import annotations

import fnmatch
import os
import stat as stat_module
from dataclasses import dataclass, field
from pathlib import Path

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

DEFAULT_SSHD_CONFIG = "/etc/ssh/sshd_config"
DEFAULT_KEYSTORE_PATHS = (
    "/etc/gateflame/keystore.json",
    "/etc/gateflame/node.key",
    "/var/lib/gateflame/keystore.json",
)
DEFAULT_AUTO_UPGRADE_CONFIG = "/etc/apt/apt.conf.d/20auto-upgrades"
DEFAULT_PIHOLE_SETUPVARS = "/etc/pihole/setupVars.conf"

# Raspberry Pi OS ships a first-boot check that writes /run/sshwarn when the
# default `pi` password is still in place and SSH is enabled. Reading that
# marker is how the default-credential question is answered WITHOUT touching
# a password hash: the OS already did the comparison, we only read its verdict.
PI_SSHWARN_MARKER = "/run/sshwarn"
PI_PASSWORD_CHECKER = "/etc/profile.d/sshpwd.sh"


# ── values ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Finding:
    id: str
    severity: str
    title: str
    observed: str
    remedy: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "severity": self.severity,
            "title": self.title,
            "observed": self.observed,
            "remedy": self.remedy,
        }


@dataclass(frozen=True)
class Gap:
    """A check that could not be completed. Never rendered as a pass."""

    id: str
    reason: str
    remedy: str

    def to_dict(self) -> dict:
        return {"id": self.id, "reason": self.reason, "remedy": self.remedy}


@dataclass(frozen=True)
class FileFacts:
    path: str
    exists: bool
    mode: int | None = None  # permission bits only
    uid: int | None = None
    gid: int | None = None
    text: str | None = None
    unreadable_reason: str | None = None


@dataclass(frozen=True)
class IncludedFile:
    pattern: str
    path: str
    text: str | None


@dataclass(frozen=True)
class SshdSource:
    path: str
    text: str | None
    includes: tuple[IncludedFile, ...] = ()
    unreadable_reason: str | None = None


@dataclass(frozen=True)
class SshdView:
    """Effective GLOBAL directives, first-wins, includes expanded in place."""

    directives: dict[str, tuple[str, str]] = field(default_factory=dict)  # key -> (value, source)
    match_conditions: tuple[str, ...] = ()
    nested_includes: tuple[str, ...] = ()
    unresolved_includes: tuple[str, ...] = ()
    readable: bool = True
    unreadable_reason: str | None = None

    def value(self, keyword: str) -> tuple[str | None, str | None]:
        found = self.directives.get(keyword.lower())
        return found if found is not None else (None, None)


@dataclass(frozen=True)
class ListeningSocket:
    address: str
    port: int
    protocol: str


@dataclass(frozen=True)
class PiUserFacts:
    exists: bool | None  # None = /etc/passwd unreadable
    passwd_unreadable_reason: str | None = None
    default_password_marker: bool | None = None  # None = undetermined
    checker_installed: bool = False
    passwordless_sudo: bool = False


@dataclass(frozen=True)
class AutoUpdateFacts:
    determinable: bool
    enabled: bool | None = None
    detail: str = ""


@dataclass(frozen=True)
class PiholeFacts:
    determinable: bool
    configured: bool | None = None
    web_password_set: bool | None = None
    detail: str = ""


@dataclass(frozen=True)
class HostFacts:
    euid: int | None
    sshd: SshdView
    pi_user: PiUserFacts
    state_files: tuple[FileFacts, ...]
    keystore_files: tuple[FileFacts, ...]
    listening: tuple[ListeningSocket, ...] | None
    listening_gap: str | None
    auto_updates: AutoUpdateFacts
    pihole: PiholeFacts


@dataclass(frozen=True)
class AuditResult:
    findings: tuple[Finding, ...]
    gaps: tuple[Gap, ...]

    def to_dict(self) -> dict:
        return {
            "findings": [f.to_dict() for f in self.findings],
            "gaps": [g.to_dict() for g in self.gaps],
            "worstSeverity": self.findings[0].severity if self.findings else None,
        }

    @property
    def finding_ids(self) -> set[str]:
        return {f.id for f in self.findings}

    @property
    def gap_ids(self) -> set[str]:
        return {g.id for g in self.gaps}


# ── sshd_config parsing (pure) ──────────────────────────────────────────────


def _tokenise(line: str) -> tuple[str, str] | None:
    text = line.strip()
    if not text or text.startswith("#"):
        return None
    # sshd accepts `Key value` and `Key=value`.
    if "=" in text and (" " not in text.split("=", 1)[0].strip()):
        key, _, value = text.partition("=")
    else:
        parts = text.split(None, 1)
        key, value = parts[0], (parts[1] if len(parts) > 1 else "")
    return key.strip().lower(), value.strip().strip('"')


def parse_sshd(source: SshdSource) -> SshdView:
    """Expand includes in place, apply first-wins, stop at the first Match.

    See the module docstring for the limits this deliberately does not exceed.
    """
    if source.text is None:
        return SshdView(
            readable=False,
            unreadable_reason=source.unreadable_reason
            or f"{source.path} could not be read",
        )

    directives: dict[str, tuple[str, str]] = {}
    matches: list[str] = []
    nested: list[str] = []
    unresolved: list[str] = []
    in_match = False

    def consume(text: str, origin: str, depth: int) -> None:
        nonlocal in_match
        for raw in text.splitlines():
            token = _tokenise(raw)
            if token is None:
                continue
            key, value = token
            if key == "match":
                # Everything from here on is conditional. We record the
                # condition and stop collecting global directives from this
                # file; sshd itself would resume global scope only at the next
                # file, which is why this flag is not reset per line.
                in_match = True
                matches.append(f"{value} (in {origin})")
                continue
            if in_match:
                continue
            if key == "include":
                if depth > 0:
                    nested.append(origin)
                    continue
                matched = [inc for inc in source.includes if inc.pattern == value]
                if not matched:
                    unresolved.append(value)
                    continue
                for inc in matched:
                    if inc.text is None:
                        unresolved.append(inc.path)
                        continue
                    consume(inc.text, inc.path, depth + 1)
                continue
            # FIRST occurrence wins — see module docstring.
            if key not in directives:
                directives[key] = (value, origin)

    consume(source.text, source.path, 0)
    return SshdView(
        directives=directives,
        match_conditions=tuple(matches),
        nested_includes=tuple(dict.fromkeys(nested)),
        unresolved_includes=tuple(dict.fromkeys(unresolved)),
        readable=True,
    )


# ── evaluation (pure) ───────────────────────────────────────────────────────


def _mode_text(mode: int | None) -> str:
    return "unknown" if mode is None else f"0{mode:03o}"


def _evaluate_ssh(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    view = facts.sshd
    if not view.readable:
        gaps.append(
            Gap(
                "sshd_config_unreadable",
                view.unreadable_reason or "sshd_config could not be read",
                "run the audit as a user that can read /etc/ssh/sshd_config (it is "
                "world-readable by default), or confirm OpenSSH is installed at all",
            )
        )
        return

    if view.unresolved_includes:
        gaps.append(
            Gap(
                "sshd_include_unresolved",
                "these Include targets could not be read, and a drop-in there overrides "
                f"the main file: {', '.join(view.unresolved_includes)}",
                "check the permissions on /etc/ssh/sshd_config.d/ and re-run the audit",
            )
        )
    if view.nested_includes:
        gaps.append(
            Gap(
                "sshd_nested_include_not_followed",
                "an included file contains its own Include, which this audit does not "
                f"follow: {', '.join(view.nested_includes)}",
                "flatten the nested Include, or verify those files by hand",
            )
        )
    if view.match_conditions:
        gaps.append(
            Gap(
                "sshd_match_blocks_present",
                "the global policy reported here can be overridden for specific "
                f"connections by these Match blocks: {'; '.join(view.match_conditions)}",
                "review each Match block by hand — `sshd -T -C user=...,addr=...` prints "
                "the effective policy for a given connection",
            )
        )

    password_auth, source = view.value("passwordauthentication")
    if password_auth is None:
        # OpenSSH's compiled default is `yes`. Stated, not silently assumed.
        findings.append(
            Finding(
                "ssh_password_auth_enabled",
                "high",
                "SSH accepts password authentication",
                "PasswordAuthentication is not set anywhere in the parsed configuration, "
                "so OpenSSH's compiled default of `yes` applies (this finding rests on "
                "that documented default, not on an observed line)",
                "set `PasswordAuthentication no` in a drop-in under /etc/ssh/sshd_config.d/ "
                "AFTER confirming a working key login, then `systemctl reload ssh`",
            )
        )
    elif password_auth.lower() == "yes":
        findings.append(
            Finding(
                "ssh_password_auth_enabled",
                "high",
                "SSH accepts password authentication",
                f"PasswordAuthentication yes (from {source}) — the node is reachable by "
                "anyone who can guess or brute-force an account password",
                "set `PasswordAuthentication no` in a drop-in under /etc/ssh/sshd_config.d/ "
                "AFTER confirming a working key login, then `systemctl reload ssh`",
            )
        )

    root_login, root_source = view.value("permitrootlogin")
    effective = (root_login or "prohibit-password").lower()
    if effective == "yes":
        findings.append(
            Finding(
                "ssh_root_login_enabled",
                "critical",
                "SSH permits direct root login",
                f"PermitRootLogin yes (from {root_source})",
                "set `PermitRootLogin no` and use a normal account with sudo; reload ssh",
            )
        )
    elif effective in ("prohibit-password", "without-password", "forced-commands-only"):
        observed = (
            f"PermitRootLogin {effective} (from {root_source})"
            if root_login is not None
            else "PermitRootLogin is not set, so OpenSSH's compiled default of "
            "`prohibit-password` applies (this finding rests on that documented default)"
        )
        findings.append(
            Finding(
                "ssh_root_login_key_only",
                "medium",
                "SSH permits root login by key",
                observed + " — root is still directly reachable, so a single stolen key "
                "is a full compromise with no sudo audit trail",
                "set `PermitRootLogin no` and log in as a normal account with sudo",
            )
        )


def _evaluate_pi_user(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    pi = facts.pi_user
    if pi.exists is None:
        gaps.append(
            Gap(
                "pi_user_undetermined",
                pi.passwd_unreadable_reason or "/etc/passwd could not be read",
                "re-run the audit as a user that can read /etc/passwd",
            )
        )
        return
    if not pi.exists:
        return

    findings.append(
        Finding(
            "pi_default_user_present",
            "medium",
            "The default `pi` account exists",
            "an account named `pi` is present in /etc/passwd — it is the first username "
            "every scanner tries against a Raspberry Pi",
            "create a personal account, move your keys to it, then `sudo deluser --remove-home pi`",
        )
    )

    if pi.default_password_marker:
        findings.append(
            Finding(
                "pi_user_default_password",
                "critical",
                "The `pi` account still has the factory password",
                f"the OS wrote {PI_SSHWARN_MARKER}, which Raspberry Pi OS creates only when "
                "the default password is still set and SSH is enabled (no password hash was "
                "read to determine this)",
                "run `passwd` as the pi user immediately, or remove the account entirely",
            )
        )
    elif pi.default_password_marker is None:
        gaps.append(
            Gap(
                "pi_password_undetermined",
                "whether the `pi` account uses a default or weak password cannot be "
                "determined here: this audit does not read password hashes from "
                f"/etc/shadow, and the OS default-password checker ({PI_PASSWORD_CHECKER}) "
                "is not installed on this host",
                "confirm by hand that the pi account's password has been changed, or "
                "remove the account",
            )
        )

    if pi.passwordless_sudo:
        findings.append(
            Finding(
                "pi_user_passwordless_sudo",
                "medium",
                "The `pi` account has passwordless sudo",
                "a sudoers drop-in grants `pi` NOPASSWD:ALL, so any compromise of that "
                "account is immediately a root compromise",
                "remove /etc/sudoers.d/010_pi-nopasswd (edit with `visudo -f`), so sudo "
                "requires the account password",
            )
        )


def _evaluate_files(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    def check(group: tuple[FileFacts, ...], kind: str, what: str, remedy: str) -> None:
        exposed: list[str] = []
        writable: list[str] = []
        missing_mode: list[str] = []
        for item in group:
            if not item.exists:
                continue
            if item.mode is None:
                missing_mode.append(item.path)
                continue
            if item.mode & 0o002:
                writable.append(f"{item.path} ({_mode_text(item.mode)})")
            elif item.mode & 0o077:
                exposed.append(f"{item.path} ({_mode_text(item.mode)})")
        if writable:
            findings.append(
                Finding(
                    f"{kind}_world_writable",
                    "critical",
                    f"{what} is world-writable",
                    ", ".join(writable),
                    remedy,
                )
            )
        if exposed:
            findings.append(
                Finding(
                    f"{kind}_group_or_world_readable",
                    "high",
                    f"{what} is readable beyond its owner",
                    ", ".join(exposed)
                    + " — anyone in that group, or any local account, can read it",
                    remedy,
                )
            )
        if missing_mode:
            gaps.append(
                Gap(
                    f"{kind}_mode_undetermined",
                    f"could not stat: {', '.join(missing_mode)}",
                    "re-run the audit as the user that owns the agent's data directory",
                )
            )

    check(
        facts.state_files,
        "state_db",
        "The agent's SQLite database",
        "`chmod 600` the database and its -wal/-shm sidecars and `chmod 700` its "
        "directory — the sidecars hold the same device-token hashes as the main file",
    )
    check(
        facts.keystore_files,
        "keystore",
        "Key/token material",
        "`chmod 600` the keystore and `chmod 700` its directory; rotate anything that "
        "has been readable by other accounts",
    )


def _evaluate_privilege(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    if facts.euid is None:
        gaps.append(
            Gap(
                "agent_privilege_undetermined",
                "the effective uid of this process could not be read",
                "check the agent's systemd unit for User= and AmbientCapabilities=",
            )
        )
        return
    if facts.euid == 0:
        findings.append(
            Finding(
                "agent_running_as_root",
                "critical",
                "The Gate^Flame agent is running as root",
                "this process has euid 0, so a single flaw in the agent is a full host "
                "compromise — and the agent does not need root, it needs one capability",
                "in gateflame.service set `User=gateflame` and "
                "`AmbientCapabilities=CAP_NET_ADMIN` (plus CAP_NET_RAW only if packet "
                "capture is ever enabled), then `systemctl daemon-reload && restart`",
            )
        )


def _evaluate_listeners(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    if facts.listening is None:
        gaps.append(
            Gap(
                "listening_sockets_undetermined",
                facts.listening_gap or "the socket table could not be read",
                "check that /proc/net/tcp and /proc/net/tcp6 are readable from this process",
            )
        )
        return
    wildcard = [s for s in facts.listening if s.address in ("0.0.0.0", "::")]
    if wildcard:
        listed = ", ".join(f"{s.address}:{s.port}/{s.protocol}" for s in sorted(
            wildcard, key=lambda s: (s.port, s.protocol)
        ))
        findings.append(
            Finding(
                "service_exposed_on_all_interfaces",
                "high",
                "Services are listening on every interface",
                f"{listed} — these accept connections from the WAN side as well as the "
                "LAN, and are only protected by whatever the firewall happens to be doing",
                "bind each service to the LAN address or to 127.0.0.1 (for the agent, set "
                "GATEFLAME_HOST to the LAN address), and verify with `ss -tlnp`",
            )
        )


def _evaluate_updates(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    au = facts.auto_updates
    if not au.determinable:
        gaps.append(
            Gap(
                "automatic_updates_undetermined",
                au.detail or "automatic update configuration could not be read",
                "confirm by hand whether security updates install automatically",
            )
        )
        return
    if au.enabled is False:
        findings.append(
            Finding(
                "automatic_security_updates_disabled",
                "high",
                "Security updates do not install automatically",
                au.detail,
                "`apt install unattended-upgrades` and set both "
                "`APT::Periodic::Update-Package-Lists \"1\";` and "
                "`APT::Periodic::Unattended-Upgrade \"1\";` in "
                "/etc/apt/apt.conf.d/20auto-upgrades",
            )
        )


def _evaluate_pihole(facts: HostFacts, findings: list[Finding], gaps: list[Gap]) -> None:
    ph = facts.pihole
    if not ph.determinable:
        gaps.append(
            Gap(
                "pihole_admin_undetermined",
                ph.detail or "the Pi-hole admin configuration could not be read",
                "if Pi-hole is installed, check `WEBPASSWORD` in "
                "/etc/pihole/setupVars.conf by hand",
            )
        )
        return
    if ph.configured and ph.web_password_set is False:
        findings.append(
            Finding(
                "pihole_admin_no_password",
                "critical",
                "The Pi-hole admin interface has no password",
                "WEBPASSWORD is empty in setupVars.conf — anyone who can reach the admin "
                "page can disable DNS filtering, add a blocklist exception, or read every "
                "DNS query the household has made",
                "run `pihole -a -p` and set a password, then restrict the admin interface "
                "to the LAN",
            )
        )


def evaluate(facts: HostFacts) -> AuditResult:
    """Pure: facts in, findings and gaps out. No I/O of any kind."""
    findings: list[Finding] = []
    gaps: list[Gap] = []
    _evaluate_privilege(facts, findings, gaps)
    _evaluate_ssh(facts, findings, gaps)
    _evaluate_pi_user(facts, findings, gaps)
    _evaluate_files(facts, findings, gaps)
    _evaluate_listeners(facts, findings, gaps)
    _evaluate_updates(facts, findings, gaps)
    _evaluate_pihole(facts, findings, gaps)
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.id))
    gaps.sort(key=lambda g: g.id)
    return AuditResult(tuple(findings), tuple(gaps))


# ── the I/O seam ────────────────────────────────────────────────────────────


class FilesystemReader:
    """The only thing in this module that touches a disk. READ-ONLY.

    `root` is injectable so a test can point it at a synthetic host tree; it is
    also the reason nothing here needs a Pi. There is deliberately no write,
    chmod, unlink or subprocess method on this class — a remediator would have
    to add one, and that addition is what the source-level test forbids.
    """

    def __init__(self, root: str | Path = "/"):
        self.root = Path(root)

    def _resolve(self, path: str) -> Path:
        return self.root / path.lstrip("/")

    def read_text(self, path: str) -> str | None:
        try:
            return self._resolve(path).read_text(errors="replace")
        except OSError:
            return None

    def stat(self, path: str) -> tuple[int, int, int] | None:
        try:
            st = self._resolve(path).stat()
        except OSError:
            return None
        return stat_module.S_IMODE(st.st_mode), st.st_uid, st.st_gid

    def exists(self, path: str) -> bool:
        return self._resolve(path).exists()

    def glob(self, pattern: str) -> list[str]:
        base = pattern.lstrip("/")
        directory, _, leaf = base.rpartition("/")
        try:
            entries = sorted(p.name for p in (self.root / directory).iterdir())
        except OSError:
            return []
        return [f"/{directory}/{name}" for name in entries if fnmatch.fnmatch(name, leaf)]

    def euid(self) -> int | None:
        try:
            return os.geteuid()
        except AttributeError:  # pragma: no cover — non-POSIX
            return None


def _file_facts(reader, path: str, with_text: bool = False) -> FileFacts:
    st = reader.stat(path)
    if st is None:
        return FileFacts(path=path, exists=False)
    mode, uid, gid = st
    text = reader.read_text(path) if with_text else None
    return FileFacts(
        path=path,
        exists=True,
        mode=mode,
        uid=uid,
        gid=gid,
        text=text,
        unreadable_reason=None if (text is not None or not with_text) else "permission denied",
    )


def collect_sshd(reader, path: str = DEFAULT_SSHD_CONFIG) -> SshdSource:
    text = reader.read_text(path)
    if text is None:
        return SshdSource(
            path=path,
            text=None,
            unreadable_reason=f"{path} is missing or unreadable from this process",
        )
    includes: list[IncludedFile] = []
    for raw in text.splitlines():
        token = _tokenise(raw)
        if token is None or token[0] != "include":
            continue
        pattern = token[1]
        # sshd expands each Include as a glob, in sorted order.
        for candidate in reader.glob(pattern) or ([pattern] if reader.exists(pattern) else []):
            includes.append(
                IncludedFile(pattern=pattern, path=candidate, text=reader.read_text(candidate))
            )
    return SshdSource(path=path, text=text, includes=tuple(includes))


def collect_pi_user(reader) -> PiUserFacts:
    passwd = reader.read_text("/etc/passwd")
    if passwd is None:
        return PiUserFacts(
            exists=None, passwd_unreadable_reason="/etc/passwd could not be read"
        )
    exists = any(line.split(":", 1)[0] == "pi" for line in passwd.splitlines() if line.strip())
    checker = reader.exists(PI_PASSWORD_CHECKER)
    marker: bool | None
    if reader.exists(PI_SSHWARN_MARKER):
        marker = True
    elif checker:
        # The OS checker is installed and did NOT raise the marker, which is a
        # real negative result rather than an absence of evidence.
        marker = False
    else:
        marker = None
    nopasswd = False
    for candidate in reader.glob("/etc/sudoers.d/*"):
        body = reader.read_text(candidate)
        if body and "NOPASSWD" in body.upper() and "pi" in body.split():
            nopasswd = True
            break
    return PiUserFacts(
        exists=exists,
        default_password_marker=marker,
        checker_installed=checker,
        passwordless_sudo=nopasswd,
    )


def _hex_to_ip(raw: str) -> str | None:
    """/proc/net/tcp writes the address in host byte order as hex."""
    try:
        if len(raw) == 8:
            octets = [int(raw[i : i + 2], 16) for i in range(0, 8, 2)]
            return ".".join(str(o) for o in reversed(octets))
        if len(raw) == 32:
            words = [raw[i : i + 8] for i in range(0, 32, 8)]
            flipped = "".join(
                "".join(reversed([w[i : i + 2] for i in range(0, 8, 2)])) for w in words
            )
            import ipaddress

            # Explicitly IPv6Address: `ip_address(1)` would hand back the
            # IPv4 address 0.0.0.1 and quietly mislabel a v6 listener.
            return str(ipaddress.IPv6Address(int(flipped, 16)))
    except ValueError:
        return None
    return None


def collect_listeners(reader) -> tuple[tuple[ListeningSocket, ...] | None, str | None]:
    found: list[ListeningSocket] = []
    read_any = False
    for path, proto in (("/proc/net/tcp", "tcp"), ("/proc/net/tcp6", "tcp6")):
        text = reader.read_text(path)
        if text is None:
            continue
        read_any = True
        for line in text.splitlines()[1:]:
            fields = line.split()
            if len(fields) < 4 or fields[3] != "0A":  # 0A = TCP_LISTEN
                continue
            local = fields[1]
            if ":" not in local:
                continue
            addr_hex, _, port_hex = local.partition(":")
            address = _hex_to_ip(addr_hex)
            try:
                port = int(port_hex, 16)
            except ValueError:
                continue
            if address is None:
                continue
            found.append(ListeningSocket(address=address, port=port, protocol=proto))
    if not read_any:
        return None, "/proc/net/tcp and /proc/net/tcp6 could not be read"
    return tuple(found), None


def collect_auto_updates(reader, path: str = DEFAULT_AUTO_UPGRADE_CONFIG) -> AutoUpdateFacts:
    if not reader.exists("/etc/apt"):
        return AutoUpdateFacts(
            determinable=False,
            detail="this host does not use apt, so unattended-upgrades is not the "
            "mechanism to check",
        )
    text = reader.read_text(path)
    if text is None:
        return AutoUpdateFacts(
            determinable=True,
            enabled=False,
            detail=f"{path} does not exist, so apt's periodic unattended upgrade is off",
        )
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip().rstrip(";")
        if not line or line.startswith("//"):
            continue
        key, _, value = line.partition(" ")
        values[key.strip()] = value.strip().strip('"')
    unattended = values.get("APT::Periodic::Unattended-Upgrade", "0")
    lists = values.get("APT::Periodic::Update-Package-Lists", "0")
    if unattended == "0":
        return AutoUpdateFacts(
            determinable=True,
            enabled=False,
            detail=f'APT::Periodic::Unattended-Upgrade is "{unattended}" in {path}',
        )
    if lists == "0":
        return AutoUpdateFacts(
            determinable=True,
            enabled=False,
            detail=f'unattended upgrades are on but APT::Periodic::Update-Package-Lists '
            f'is "{lists}" in {path}, so the package lists are never refreshed and no '
            "new security update is ever seen",
        )
    return AutoUpdateFacts(determinable=True, enabled=True, detail=f"enabled in {path}")


def collect_pihole(reader, path: str = DEFAULT_PIHOLE_SETUPVARS) -> PiholeFacts:
    if not reader.exists("/etc/pihole"):
        return PiholeFacts(
            determinable=True,
            configured=False,
            web_password_set=None,
            detail="Pi-hole is not installed on this host",
        )
    text = reader.read_text(path)
    if text is None:
        return PiholeFacts(
            determinable=False,
            configured=True,
            detail=f"Pi-hole is installed but {path} is not readable from this process "
            "(it is usually root-owned), so the admin password state is unknown",
        )
    for raw in text.splitlines():
        if raw.startswith("WEBPASSWORD="):
            value = raw.split("=", 1)[1].strip()
            return PiholeFacts(
                determinable=True,
                configured=True,
                web_password_set=bool(value),
                detail="WEBPASSWORD is empty" if not value else "WEBPASSWORD is set",
            )
    return PiholeFacts(
        determinable=True,
        configured=True,
        web_password_set=False,
        detail=f"no WEBPASSWORD line in {path}, which Pi-hole treats as no password",
    )


def collect(
    reader=None,
    *,
    db_path: str | None = None,
    keystore_paths: tuple[str, ...] = DEFAULT_KEYSTORE_PATHS,
    sshd_config_path: str = DEFAULT_SSHD_CONFIG,
) -> HostFacts:
    """Gather everything `evaluate` needs. Read-only, one seam."""
    reader = reader if reader is not None else FilesystemReader()
    db = db_path or os.environ.get("GATEFLAME_DB_PATH", "/var/lib/gateflame/state.db")
    state_targets = [db, f"{db}-wal", f"{db}-shm", str(Path(db).parent)]
    listening, listening_gap = collect_listeners(reader)
    return HostFacts(
        euid=reader.euid(),
        sshd=parse_sshd(collect_sshd(reader, sshd_config_path)),
        pi_user=collect_pi_user(reader),
        state_files=tuple(_file_facts(reader, p) for p in state_targets),
        keystore_files=tuple(_file_facts(reader, p) for p in keystore_paths),
        listening=listening,
        listening_gap=listening_gap,
        auto_updates=collect_auto_updates(reader),
        pihole=collect_pihole(reader),
    )


class PostureAudit:
    """module_zero_trust. `services.py` owns the instance."""

    def __init__(self, reader=None, db_path: str | None = None, keystore_paths=None):
        self._reader = reader if reader is not None else FilesystemReader()
        self._db_path = db_path
        self._keystore_paths = (
            tuple(keystore_paths) if keystore_paths is not None else DEFAULT_KEYSTORE_PATHS
        )

    def capability(self) -> tuple[bool, str | None]:
        """(usable, gap) — the registry's contract. Never raises.

        A posture audit degrades rather than fails: if it cannot read the two
        cheapest pieces of evidence it has nothing honest to say, and says so.
        """
        try:
            can_read_passwd = self._reader.read_text("/etc/passwd") is not None
            can_read_sockets = self._reader.read_text("/proc/net/tcp") is not None
        except Exception as exc:  # noqa: BLE001 — a status call must not throw
            return False, f"posture audit cannot read this host: {exc}"
        if not can_read_passwd and not can_read_sockets:
            return False, (
                "cannot read /etc/passwd or /proc/net/tcp — this host does not expose the "
                "evidence a posture audit needs (expected on a non-Linux dev machine); "
                "run the agent on the appliance to get a real audit"
            )
        return True, None

    def audit(self) -> dict:
        usable, gap = self.capability()
        if not usable:
            return {"findings": [], "gaps": [], "worstSeverity": None, "gap": gap}
        facts = collect(
            self._reader, db_path=self._db_path, keystore_paths=self._keystore_paths
        )
        result = evaluate(facts).to_dict()
        result["gap"] = gap
        result["readOnly"] = True
        return result

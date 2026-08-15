"""Tests for module_zero_trust.

Two things are being proved here.

1. THE AUDIT NEVER CHANGES THE HOST. Auditing and remediating are different
   products: an audit that is wrong prints a wrong sentence, a remediator that
   is wrong locks a customer out of their own Pi from another country. §8
   asserts read-onlyness at the source level so a future edit cannot quietly
   add a write.

2. THE FINDINGS ARE EXACTLY RIGHT ON BOTH ENDS OF THE RANGE. A hardened host
   must produce an empty finding set — a check that cries wolf gets switched
   off — and a wide-open host must produce every finding, with nothing quietly
   passing because its evidence was unreadable. §1 pins both sets exactly.

Every host in this file is synthetic: a dict of paths and modes behind the
same reader seam the real module uses. No root, no Pi, no network.
"""

from __future__ import annotations

import fnmatch

import pytest

from gateflame import posture
from gateflame.posture import (
    Gap,
    HostFacts,
    PostureAudit,
    SshdSource,
    collect,
    collect_listeners,
    evaluate,
    parse_sshd,
)

# ── the synthetic host ─────────────────────────────────────────────────────


class SyntheticHost:
    """A whole filesystem as a dict. Read-only by construction: there is no
    method here that could write, which is the point."""

    def __init__(self, files: dict[str, str], modes=None, dirs=(), euid_value=1000,
                 unreadable=()):
        self.files = dict(files)
        self.modes = dict(modes or {})
        self.unreadable = set(unreadable)
        self.dirs = set(dirs)
        for path in self.files:
            parts = path.strip("/").split("/")
            for i in range(1, len(parts)):
                self.dirs.add("/" + "/".join(parts[:i]))
        self._euid = euid_value

    # -- the reader interface --------------------------------------------
    def read_text(self, path):
        if path in self.unreadable:
            return None
        return self.files.get(path)

    def stat(self, path):
        if path in self.files:
            return self.modes.get(path, 0o600), 0, 0
        if path in self.dirs:
            return self.modes.get(path, 0o700), 0, 0
        return None

    def exists(self, path):
        return path in self.files or path in self.dirs

    def glob(self, pattern):
        return sorted(p for p in self.files if fnmatch.fnmatch(p, pattern))

    def euid(self):
        return self._euid


def tcp_table(rows):
    header = (
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when "
        "retrnsmt   uid  timeout inode\n"
    )
    body = "".join(
        f"   {i}: {local} 00000000:0000 {state} 00000000:00000000 "
        "00:00000000 00000000  1000        0 100 1\n"
        for i, (local, state) in enumerate(rows)
    )
    return header + body


LOOPBACK_ONLY = tcp_table([("0100007F:1F90", "0A"), ("0100007F:0016", "0A")])
WILDCARD = tcp_table([("00000000:0016", "0A"), ("00000000:0050", "0A")])

DB = "/var/lib/gateflame/state.db"
KEYSTORE = ("/etc/gateflame/keystore.json",)


def hardened_host(**overrides) -> SyntheticHost:
    """A correctly set up appliance. Note the sshd layout: the drop-in is
    read first (because the Include is the first line) and OpenSSH takes the
    FIRST value it obtains, so the permissive lines later in the main file are
    dead. An audit that got either rule backwards would report this host as
    wide open."""
    files = {
        "/etc/ssh/sshd_config": (
            "Include /etc/ssh/sshd_config.d/*.conf\n"
            "# these are overridden by the drop-in above and never take effect\n"
            "PasswordAuthentication yes\n"
            "PermitRootLogin yes\n"
        ),
        "/etc/ssh/sshd_config.d/99-hardening.conf": (
            "PasswordAuthentication no\nPermitRootLogin no\n"
        ),
        "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\ngateflame:x:1000:1000::/var/lib/gateflame:/usr/sbin/nologin\n",
        DB: "sqlite",
        DB + "-wal": "wal",
        "/etc/gateflame/keystore.json": "{}",
        "/proc/net/tcp": LOOPBACK_ONLY,
        "/etc/apt/apt.conf.d/20auto-upgrades": (
            'APT::Periodic::Update-Package-Lists "1";\n'
            'APT::Periodic::Unattended-Upgrade "1";\n'
        ),
        "/etc/pihole/setupVars.conf": "WEBPASSWORD=9f86d081884c7d659a2f\nIPV4_ADDRESS=192.168.1.2\n",
    }
    modes = {
        DB: 0o600,
        DB + "-wal": 0o600,
        "/var/lib/gateflame": 0o700,
        "/etc/gateflame/keystore.json": 0o600,
    }
    files.update(overrides.pop("files", {}))
    modes.update(overrides.pop("modes", {}))
    return SyntheticHost(files, modes=modes, euid_value=overrides.pop("euid_value", 1000),
                         **overrides)


def wide_open_host(**overrides) -> SyntheticHost:
    files = {
        "/etc/ssh/sshd_config": "PermitRootLogin yes\nPasswordAuthentication yes\n",
        "/etc/passwd": "root:x:0:0:root:/root:/bin/bash\npi:x:1000:1000:,,,:/home/pi:/bin/bash\n",
        "/run/sshwarn": "SSH is enabled and the default password for the 'pi' user has not been changed.\n",
        "/etc/profile.d/sshpwd.sh": "#!/bin/sh\n",
        "/etc/sudoers.d/010_pi-nopasswd": "pi ALL=(ALL) NOPASSWD: ALL\n",
        DB: "sqlite",
        DB + "-wal": "wal",
        "/etc/gateflame/keystore.json": "{}",
        "/proc/net/tcp": WILDCARD,
        "/etc/apt/apt.conf.d/50unattended-upgrades": "// nothing enabled\n",
        "/etc/pihole/setupVars.conf": "WEBPASSWORD=\nIPV4_ADDRESS=192.168.1.2\n",
    }
    modes = {
        DB: 0o644,
        DB + "-wal": 0o644,
        "/var/lib/gateflame": 0o755,
        "/etc/gateflame/keystore.json": 0o666,
    }
    files.update(overrides.pop("files", {}))
    modes.update(overrides.pop("modes", {}))
    return SyntheticHost(files, modes=modes, euid_value=overrides.pop("euid_value", 0),
                         **overrides)


def audit_of(host) -> posture.AuditResult:
    return evaluate(collect(host, db_path=DB, keystore_paths=KEYSTORE))


# ── 1. The two ends of the range, pinned exactly ───────────────────────────


def test_a_hardened_host_produces_no_findings_and_no_gaps():
    """A check that cries wolf on a correct configuration gets switched off,
    and then it protects nobody."""
    result = audit_of(hardened_host())
    assert result.finding_ids == set()
    assert result.gap_ids == set()


def test_a_wide_open_host_produces_exactly_the_expected_findings():
    result = audit_of(wide_open_host())
    assert result.finding_ids == {
        "agent_running_as_root",
        "ssh_root_login_enabled",
        "ssh_password_auth_enabled",
        "pi_default_user_present",
        "pi_user_default_password",
        "pi_user_passwordless_sudo",
        "state_db_group_or_world_readable",
        "keystore_world_writable",
        "service_exposed_on_all_interfaces",
        "automatic_security_updates_disabled",
        "pihole_admin_no_password",
    }
    assert result.gap_ids == set()


def test_findings_are_ordered_worst_first():
    result = audit_of(wide_open_host())
    severities = [posture.SEVERITY_ORDER[f.severity] for f in result.findings]
    assert severities == sorted(severities)
    assert result.to_dict()["worstSeverity"] == "critical"


def test_every_finding_carries_a_stable_id_severity_observation_and_remedy():
    """A finding without a remedy is a complaint. The operator has to be able
    to act on every line this module prints."""
    for result in (audit_of(wide_open_host()), audit_of(hardened_host())):
        for finding in result.findings:
            assert finding.id and finding.id.islower()
            assert finding.severity in posture.SEVERITY_ORDER
            assert len(finding.observed) > 20
            assert len(finding.remedy) > 20


def test_finding_ids_are_unique_within_a_report():
    result = audit_of(wide_open_host())
    ids = [f.id for f in result.findings]
    assert len(ids) == len(set(ids))


# ── 2. sshd_config parsing, and the limits of it ───────────────────────────


def sshd(text, includes=()):
    return parse_sshd(SshdSource(path="/etc/ssh/sshd_config", text=text, includes=includes))


def test_the_first_value_wins_not_the_last():
    """OpenSSH takes the FIRST value obtained for each keyword. This is the
    opposite of most config formats and is the single most common way a
    hand-written sshd audit reports the answer backwards."""
    view = sshd("PasswordAuthentication no\nPasswordAuthentication yes\n")
    assert view.value("passwordauthentication")[0] == "no"


def test_a_drop_in_include_beats_the_main_file():
    """Debian and Raspberry Pi OS put `Include /etc/ssh/sshd_config.d/*.conf`
    on the first line precisely so drop-ins win. An audit that ignored
    includes would read this host as accepting passwords."""
    view = sshd(
        "Include /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication yes\n",
        includes=(
            posture.IncludedFile(
                pattern="/etc/ssh/sshd_config.d/*.conf",
                path="/etc/ssh/sshd_config.d/99-hardening.conf",
                text="PasswordAuthentication no\n",
            ),
        ),
    )
    value, source = view.value("passwordauthentication")
    assert value == "no"
    assert source.endswith("99-hardening.conf")


def test_an_include_placed_after_a_directive_does_not_override_it():
    view = sshd(
        "PasswordAuthentication yes\nInclude /etc/ssh/sshd_config.d/*.conf\n",
        includes=(
            posture.IncludedFile(
                pattern="/etc/ssh/sshd_config.d/*.conf",
                path="/etc/ssh/sshd_config.d/99.conf",
                text="PasswordAuthentication no\n",
            ),
        ),
    )
    assert view.value("passwordauthentication")[0] == "yes"


def test_directives_inside_a_match_block_are_not_treated_as_global():
    view = sshd(
        "PasswordAuthentication no\n"
        "Match Address 192.168.1.0/24\n"
        "    PasswordAuthentication yes\n"
    )
    assert view.value("passwordauthentication")[0] == "no"
    assert view.match_conditions


def test_match_blocks_are_reported_as_a_gap_rather_than_silently_ignored():
    """We report the global policy. Whether a Match block loosens it for some
    user or subnet is a question this module cannot answer, so it says so."""
    result = evaluate(
        collect(
            hardened_host(
                files={
                    "/etc/ssh/sshd_config.d/99-hardening.conf": (
                        "PasswordAuthentication no\n"
                        "PermitRootLogin no\n"
                        "Match User deploy\n"
                        "    PasswordAuthentication yes\n"
                    )
                }
            ),
            db_path=DB,
            keystore_paths=KEYSTORE,
        )
    )
    assert "sshd_match_blocks_present" in result.gap_ids
    gap = next(g for g in result.gaps if g.id == "sshd_match_blocks_present")
    assert "deploy" in gap.reason
    assert "sshd -T" in gap.remedy


def test_an_unreadable_include_is_a_gap_not_a_pass():
    """A drop-in we cannot read may be the file that decides the answer."""
    view = sshd(
        "Include /etc/ssh/sshd_config.d/*.conf\nPasswordAuthentication no\n",
        includes=(
            posture.IncludedFile(
                pattern="/etc/ssh/sshd_config.d/*.conf",
                path="/etc/ssh/sshd_config.d/10-secret.conf",
                text=None,
            ),
        ),
    )
    assert view.unresolved_includes == ("/etc/ssh/sshd_config.d/10-secret.conf",)
    facts = collect(hardened_host(unreadable=("/etc/ssh/sshd_config.d/99-hardening.conf",)),
                    db_path=DB, keystore_paths=KEYSTORE)
    assert "sshd_include_unresolved" in evaluate(facts).gap_ids


def test_a_nested_include_is_declared_not_followed():
    view = sshd(
        "Include /etc/ssh/sshd_config.d/*.conf\n",
        includes=(
            posture.IncludedFile(
                pattern="/etc/ssh/sshd_config.d/*.conf",
                path="/etc/ssh/sshd_config.d/10.conf",
                text="Include /etc/ssh/deeper.conf\n",
            ),
        ),
    )
    assert view.nested_includes == ("/etc/ssh/sshd_config.d/10.conf",)


def test_comments_and_equals_syntax_are_both_handled():
    view = sshd("# PasswordAuthentication yes\nPermitRootLogin=no\n")
    assert view.value("passwordauthentication")[0] is None
    assert view.value("permitrootlogin")[0] == "no"


def test_an_unreadable_sshd_config_is_a_gap_and_produces_no_ssh_findings():
    """'I could not read sshd_config' must never render as 'SSH is fine'."""
    host = hardened_host(unreadable=("/etc/ssh/sshd_config",))
    result = audit_of(host)
    assert "sshd_config_unreadable" in result.gap_ids
    assert not [f for f in result.findings if f.id.startswith("ssh_")]


@pytest.mark.parametrize(
    "config,expected",
    [
        ("PermitRootLogin yes\n", "ssh_root_login_enabled"),
        ("PermitRootLogin prohibit-password\n", "ssh_root_login_key_only"),
        ("PermitRootLogin without-password\n", "ssh_root_login_key_only"),
        ("PermitRootLogin no\n", None),
    ],
)
def test_root_login_values_map_to_the_right_finding(config, expected):
    host = hardened_host(
        files={"/etc/ssh/sshd_config.d/99-hardening.conf": "PasswordAuthentication no\n" + config}
    )
    ids = audit_of(host).finding_ids
    root_findings = {i for i in ids if i.startswith("ssh_root")}
    assert root_findings == ({expected} if expected else set())


def test_an_absent_directive_is_reported_against_the_documented_default():
    """OpenSSH's compiled defaults are PasswordAuthentication yes and
    PermitRootLogin prohibit-password. Both findings must say that they rest
    on a default rather than on an observed line."""
    host = hardened_host(
        files={
            "/etc/ssh/sshd_config": "Include /etc/ssh/sshd_config.d/*.conf\n# nothing else\n",
            "/etc/ssh/sshd_config.d/99-hardening.conf": "# empty\n",
        }
    )
    result = audit_of(host)
    assert "ssh_password_auth_enabled" in result.finding_ids
    assert "ssh_root_login_key_only" in result.finding_ids
    for finding in result.findings:
        if finding.id.startswith("ssh_"):
            assert "default" in finding.observed


# ── 3. The `pi` user, without reading a password hash ──────────────────────


def test_the_default_password_verdict_comes_from_the_os_marker_not_a_hash():
    result = audit_of(wide_open_host())
    finding = next(f for f in result.findings if f.id == "pi_user_default_password")
    assert "/run/sshwarn" in finding.observed
    assert "no password hash was read" in finding.observed


def test_a_changed_password_is_a_real_negative_when_the_checker_is_installed():
    """The OS checker is present and did not raise the marker. That is
    evidence, not absence of evidence, so it is not reported as a gap."""
    host = wide_open_host()
    del host.files["/run/sshwarn"]
    result = audit_of(host)
    assert "pi_user_default_password" not in result.finding_ids
    assert "pi_password_undetermined" not in result.gap_ids


def test_without_the_os_checker_the_password_state_is_a_named_gap():
    """No marker and no checker means we simply do not know — and saying
    nothing here would let a factory password pass as audited."""
    host = wide_open_host()
    del host.files["/run/sshwarn"]
    del host.files["/etc/profile.d/sshpwd.sh"]
    result = audit_of(host)
    assert "pi_password_undetermined" in result.gap_ids
    gap = next(g for g in result.gaps if g.id == "pi_password_undetermined")
    assert "/etc/shadow" in gap.reason


def test_the_audit_never_reads_the_shadow_file():
    """Reading password hashes would need root and would put them in this
    process's memory. The module must not ask for /etc/shadow at all."""

    class Watching(SyntheticHost):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.reads = []

        def read_text(self, path):
            self.reads.append(path)
            return super().read_text(path)

    host = Watching(wide_open_host().files, euid_value=0)
    collect(host, db_path=DB, keystore_paths=KEYSTORE)
    assert host.reads, "the collector read nothing at all — the seam is not wired up"
    assert not any("shadow" in path for path in host.reads)


def test_an_unreadable_passwd_file_is_a_gap():
    host = wide_open_host(unreadable=("/etc/passwd",))
    result = audit_of(host)
    assert "pi_user_undetermined" in result.gap_ids
    assert not [f for f in result.findings if f.id.startswith("pi_")]


def test_no_pi_user_means_no_pi_findings():
    assert not [f for f in audit_of(hardened_host()).findings if f.id.startswith("pi_")]


# ── 4. The agent's own privilege ───────────────────────────────────────────


def test_running_as_root_is_critical_and_names_the_capability_remedy():
    """The agent needs CAP_NET_ADMIN, not root. Saying so is the whole point
    of the finding — 'do not run as root' without the alternative gets ignored."""
    finding = next(
        f for f in audit_of(wide_open_host()).findings if f.id == "agent_running_as_root"
    )
    assert finding.severity == "critical"
    assert "AmbientCapabilities=CAP_NET_ADMIN" in finding.remedy
    assert "User=" in finding.remedy


def test_an_unprivileged_agent_produces_no_privilege_finding():
    assert "agent_running_as_root" not in audit_of(hardened_host()).finding_ids


def test_an_unknown_euid_is_a_gap_rather_than_a_pass():
    facts = collect(hardened_host(), db_path=DB, keystore_paths=KEYSTORE)
    blind = HostFacts(**{**facts.__dict__, "euid": None})
    assert "agent_privilege_undetermined" in evaluate(blind).gap_ids


# ── 5. File permissions on state and key material ──────────────────────────


def test_the_wal_sidecar_is_checked_too():
    """state.db-wal holds the same device-token hashes as state.db. Checking
    only the main file would give a clean report on an exposed database."""
    host = hardened_host(modes={DB + "-wal": 0o644})
    result = audit_of(host)
    assert "state_db_group_or_world_readable" in result.finding_ids
    finding = next(f for f in result.findings if f.id == "state_db_group_or_world_readable")
    assert "state.db-wal" in finding.observed


def test_the_containing_directory_is_checked_too():
    host = hardened_host(modes={"/var/lib/gateflame": 0o755})
    assert "state_db_group_or_world_readable" in audit_of(host).finding_ids


def test_world_writable_key_material_outranks_merely_readable():
    host = hardened_host(modes={"/etc/gateflame/keystore.json": 0o666})
    result = audit_of(host)
    assert "keystore_world_writable" in result.finding_ids
    assert "keystore_group_or_world_readable" not in result.finding_ids
    assert next(f for f in result.findings if f.id == "keystore_world_writable").severity == "critical"


def test_a_readable_keystore_is_flagged_and_advises_rotation():
    host = hardened_host(modes={"/etc/gateflame/keystore.json": 0o640})
    finding = next(
        f for f in audit_of(host).findings if f.id == "keystore_group_or_world_readable"
    )
    assert "0640" in finding.observed
    assert "rotate" in finding.remedy


def test_a_file_that_does_not_exist_is_not_a_finding():
    """Absent key material is not insecure key material."""
    host = hardened_host()
    del host.files["/etc/gateflame/keystore.json"]
    assert not [f for f in audit_of(host).findings if f.id.startswith("keystore")]


# ── 6. Listening sockets ───────────────────────────────────────────────────


def test_loopback_only_listeners_are_not_flagged():
    assert "service_exposed_on_all_interfaces" not in audit_of(hardened_host()).finding_ids


def test_wildcard_listeners_are_flagged_with_their_ports():
    finding = next(
        f
        for f in audit_of(wide_open_host()).findings
        if f.id == "service_exposed_on_all_interfaces"
    )
    assert "0.0.0.0:22" in finding.observed
    assert "0.0.0.0:80" in finding.observed
    assert "GATEFLAME_HOST" in finding.remedy


def test_ipv6_wildcard_and_loopback_are_decoded_correctly():
    host = SyntheticHost(
        {
            "/proc/net/tcp": tcp_table([("0100007F:1F90", "0A")]),
            "/proc/net/tcp6": tcp_table(
                [
                    ("00000000000000000000000000000000:0016", "0A"),
                    ("00000000000000000000000001000000:1F90", "0A"),
                ]
            ),
        }
    )
    listeners, gap = collect_listeners(host)
    assert gap is None
    assert ("::", 22) in [(s.address, s.port) for s in listeners]
    assert ("::1", 8080) in [(s.address, s.port) for s in listeners]


def test_only_sockets_in_the_listen_state_are_reported():
    """An established outbound connection is not an exposed service."""
    host = SyntheticHost(
        {"/proc/net/tcp": tcp_table([("00000000:0016", "01"), ("00000000:0050", "0A")])}
    )
    listeners, _ = collect_listeners(host)
    assert [s.port for s in listeners] == [80]


def test_an_unreadable_socket_table_is_a_gap_not_an_empty_list():
    """An empty list would render as 'nothing is exposed', which is the most
    dangerous thing this module could say without evidence."""
    host = SyntheticHost({"/etc/passwd": "root:x:0:0::/root:/bin/sh\n"})
    listeners, gap = collect_listeners(host)
    assert listeners is None
    assert "/proc/net/tcp" in gap
    assert "listening_sockets_undetermined" in audit_of(host).gap_ids


# ── 7. Automatic updates and Pi-hole ───────────────────────────────────────


def test_enabled_unattended_upgrades_produce_no_finding():
    assert "automatic_security_updates_disabled" not in audit_of(hardened_host()).finding_ids


def test_a_missing_auto_upgrade_config_means_updates_are_off():
    finding = next(
        f
        for f in audit_of(wide_open_host()).findings
        if f.id == "automatic_security_updates_disabled"
    )
    assert "20auto-upgrades" in finding.observed
    assert "unattended-upgrades" in finding.remedy


def test_upgrades_on_but_package_lists_never_refreshed_is_still_a_finding():
    """A very common half-configuration: unattended-upgrades runs but never
    sees a new security update because the lists are never updated."""
    host = hardened_host(
        files={
            "/etc/apt/apt.conf.d/20auto-upgrades": (
                'APT::Periodic::Update-Package-Lists "0";\n'
                'APT::Periodic::Unattended-Upgrade "1";\n'
            )
        }
    )
    finding = next(
        f for f in audit_of(host).findings if f.id == "automatic_security_updates_disabled"
    )
    assert "never refreshed" in finding.observed


def test_a_non_apt_host_reports_a_gap_rather_than_a_false_finding():
    host = hardened_host()
    del host.files["/etc/apt/apt.conf.d/20auto-upgrades"]
    host.dirs = {d for d in host.dirs if not d.startswith("/etc/apt")}
    result = audit_of(host)
    assert "automatic_security_updates_disabled" not in result.finding_ids
    assert "automatic_updates_undetermined" in result.gap_ids


def test_an_empty_pihole_password_is_critical():
    finding = next(
        f for f in audit_of(wide_open_host()).findings if f.id == "pihole_admin_no_password"
    )
    assert finding.severity == "critical"
    assert "pihole -a -p" in finding.remedy


def test_no_pihole_installed_is_neither_a_finding_nor_a_gap():
    host = hardened_host()
    del host.files["/etc/pihole/setupVars.conf"]
    host.dirs.discard("/etc/pihole")
    result = audit_of(host)
    assert "pihole_admin_no_password" not in result.finding_ids
    assert "pihole_admin_undetermined" not in result.gap_ids


def test_pihole_installed_but_unreadable_config_is_a_gap():
    """setupVars.conf is normally root-owned and this agent is not root, so
    this is the expected outcome on a real appliance — and it must not read as
    'the admin password is fine'."""
    host = hardened_host(unreadable=("/etc/pihole/setupVars.conf",))
    result = audit_of(host)
    assert "pihole_admin_undetermined" in result.gap_ids
    assert "pihole_admin_no_password" not in result.finding_ids


# ── 8. Read-only, and honest about it ──────────────────────────────────────


def test_the_module_contains_no_way_to_change_the_host():
    """Silently rewriting a customer's sshd_config is unacceptable, so the
    capability to do it must not exist in this file at all. If a future edit
    adds remediation here, this fails and says why."""
    import pathlib

    source = pathlib.Path(posture.__file__).read_text()
    for forbidden in (
        "write_text",
        "os.remove",
        "os.rename",
        "os.chmod",
        "os.chown",
        "shutil.",
        "unlink(",
        "mkdir(",
        "import subprocess",
        "subprocess.run(",
        "os.system",
        "os.popen",
        "shell=True",
        "httpx",
        "import socket",
        "socket.socket",
        "create_connection",
    ):
        assert forbidden not in source, forbidden
    assert 'open(' not in source.replace("# ", "")


def test_the_reader_seam_exposes_no_mutating_method():
    for name in dir(posture.FilesystemReader):
        assert name not in ("write_text", "write", "chmod", "unlink", "remove", "mkdir")


def test_running_the_audit_twice_changes_nothing_about_the_host():
    host = wide_open_host()
    before = (dict(host.files), dict(host.modes))
    first = audit_of(host)
    second = audit_of(host)
    assert (host.files, host.modes) == before
    assert first.finding_ids == second.finding_ids


def test_evaluate_is_pure_and_touches_no_filesystem():
    """`evaluate` takes facts and returns findings. Feeding it the same facts
    twice must give the same answer, with no host access in between."""
    facts = collect(wide_open_host(), db_path=DB, keystore_paths=KEYSTORE)
    assert evaluate(facts).to_dict() == evaluate(facts).to_dict()


def test_the_parse_limits_are_documented_in_the_module():
    """These limits are what stop a finding being over-trusted. If the
    docstring loses them, the findings become claims they cannot support."""
    doc = posture.__doc__
    for phrase in ("FIRST-MATCH-WINS", "Include", "Match", "Nested includes"):
        assert phrase in doc


# ── 9. Capability reporting ────────────────────────────────────────────────


def test_capability_is_usable_on_a_host_that_exposes_its_evidence():
    audit = PostureAudit(reader=hardened_host(), db_path=DB, keystore_paths=KEYSTORE)
    assert audit.capability() == (True, None)


def test_capability_is_degraded_with_a_named_gap_on_a_host_with_no_evidence():
    audit = PostureAudit(reader=SyntheticHost({}), db_path=DB)
    usable, gap = audit.capability()
    assert usable is False
    assert "/etc/passwd" in gap and "/proc/net/tcp" in gap
    assert "run the agent on the appliance" in gap


def test_capability_never_raises():
    class Exploding(SyntheticHost):
        def read_text(self, path):
            raise OSError("boom")

    audit = PostureAudit(reader=Exploding({}), db_path=DB)
    usable, gap = audit.capability()
    assert usable is False
    assert "boom" in gap


def test_a_degraded_audit_returns_no_findings_and_the_gap():
    audit = PostureAudit(reader=SyntheticHost({}), db_path=DB)
    result = audit.audit()
    assert result["findings"] == []
    assert result["worstSeverity"] is None
    assert result["gap"]


def test_the_audit_entry_point_returns_serialisable_findings():
    audit = PostureAudit(reader=wide_open_host(), db_path=DB, keystore_paths=KEYSTORE)
    result = audit.audit()
    assert result["readOnly"] is True
    assert result["worstSeverity"] == "critical"
    ids = {f["id"] for f in result["findings"]}
    assert "agent_running_as_root" in ids
    for finding in result["findings"]:
        assert set(finding) == {"id", "severity", "title", "observed", "remedy"}
    for gap in result["gaps"]:
        assert set(gap) == {"id", "reason", "remedy"}


def test_gaps_carry_a_remedy_too():
    gap = Gap("x", "y", "z")
    assert gap.to_dict() == {"id": "x", "reason": "y", "remedy": "z"}
    for result in (audit_of(wide_open_host(unreadable=("/etc/passwd", "/proc/net/tcp"))),):
        for item in result.gaps:
            assert item.reason and item.remedy

```
========================================================================================
GATE^FLAME — RUN THIS ON THE PI (wabapi @ 192.168.0.10)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-PIRUN | Version: 2.1 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# 🔴 Change that password first

`12345678` on `wabapi@192.168.0.10` went through a chat transcript, so by this
project's own standing rule it is disclosed. It is also an eight-digit numeric
password on the appliance whose entire job is network security — it would not
survive ten seconds of the credential-stuffing that hits any exposed SSH port.

```bash
passwd                                   # on the Pi, as wabapi
```

## ⚠️ Corrected 2026-08-15 — the earlier version of this section locked the Pi out

v1.0 of this document put `PasswordAuthentication no` here as a paste-ready
command with only a sentence of warning in front of it. In a document written to
be pasted, that guard belongs **in the command**, not in the prose. Run before a
key is installed, it ends the session's ability to log back in.

If that already happened, see `SSH-RECOVERY.md` — nothing is lost, and there is
a headless fix that needs no monitor.

**The lockout-proof version.** It refuses to proceed unless a key already works.

On wabakipi, PowerShell:

```powershell
ssh-keygen -t ed25519 -C "dennis@wabakipi"

type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh wabapi@192.168.0.10 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# PROVE it, before changing anything
ssh -o PasswordAuthentication=no wabapi@192.168.0.10 "echo KEY_LOGIN_WORKS"
```

Only if that printed `KEY_LOGIN_WORKS`, then on the Pi:

```bash
sudo tee /etc/ssh/sshd_config.d/10-gateflame-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sudo sshd -t && sudo systemctl restart ssh && echo OK
```

`sshd -t` before the restart is not optional — it proves the config parses.
Restarting with a broken config drops sshd entirely, which is a worse lockout
than the one this section caused. Keep the current session open and test from a
second terminal, every time.

A drop-in beats editing the main config: one file to delete to reverse it, and a
distribution upgrade will not fight you over it.

I have not used the password and cannot — see the note at the bottom.

---

## Step 1 — Get the package onto the Pi

From **PowerShell on wabakipi**:

```powershell
scp "$env:USERPROFILE\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-pi-v2-2026-08-15.tar.gz" wabapi@192.168.0.10:~/
```

## Step 2 — One paste, on the Pi

```bash
ssh wabapi@192.168.0.10
```

Then paste this whole block:

```bash
cd ~ && rm -rf gateflame-pi && tar -xzf gateflame-pi-v2-2026-08-15.tar.gz && cd gateflame-pi && \
sudo bash deploy-on-pi.sh 2>&1 | tee ~/gateflame-deploy.log
```

Five to ten minutes, most of it pip building wheels. It runs five stages and
stops at the first real failure:

| Stage | What it does |
|---|---|
| **0** preflight | model, kernel, OS, arch, Python, `:8080` occupancy, free space — fails in seconds with a reason rather than minutes into a pip build |
| **1** prereqs | python3-venv, python3-dev, build-essential, iproute2, nftables, avahi, and `vcgencmd` |
| **2** install | service user, venv, hardened systemd unit, enabled and started on `:8080` |
| **3** capabilities + mDNS | `CAP_NET_ADMIN` / `CAP_NET_RAW` drop-in, and `gateflame.local` published so the app's first discovery candidate resolves |
| **4** validate | waits for the agent to actually answer, then runs the 19 read-only hardware checks |

## Step 3 — Send me the report

The run writes everything I need to one file:

```bash
cat /tmp/gateflame-deploy-report.txt
```

Paste it here, or drop it in a folder I can read. It contains the hardware, the
service state, the drop-ins, listening sockets, **the running process's actual
capabilities and groups**, external tool paths, all four API responses, a
captured validator run, and 120 log lines. That is enough to diagnose almost
anything without a shell.

## Step 4 — Pair the phone

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request
```

Type the six digits into the app within five minutes.

---

## What changed since the v1 package

Four things that fire on a Pi and never in a container:

1. **`install.sh` was not idempotent** — and re-running is the normal case.
   `cp -r` onto an existing install *merges*: modules the new version deleted or
   renamed survive from the old one, so the install quietly runs a mix of two
   versions. Now replaced wholesale, `__pycache__` included, because stale
   bytecode outlives a source replacement.

2. **The service could not read `/dev/vcio`.** It is `root:video`; the
   `gateflame` user was in no supplementary groups. `vcgencmd` would have run
   and got permission denied — so throttle flags read `null` on a Pi that can
   report them perfectly well. A silent wrong answer, which is worse than an
   error. Fixed with `SupplementaryGroups=video`.

3. **The mDNS alias baked in the IP at install time.** One DHCP lease change and
   `gateflame.local` still resolves — to an address nothing is listening on. The
   phone would report "found a node", then time out on every call. Now resolved
   at service start, and it waits for DHCP, because `network-online.target` can
   fire before a lease exists.

4. **Validation started too early.** systemd calls a `Type=simple` unit active
   the instant it forks, well before uvicorn binds the port. Now it waits for a
   real answer first — a check that fails in that window is worse than no check.

Plus: `python3-dev` and `build-essential`, so a 32-bit Pi can build `psutil`
instead of dying on `Python.h: No such file or directory`; and the uninstall now
removes the mDNS unit, wrapper and avahi file it used to leave behind.

---

## Why I can't just SSH in myself

I tested both routes rather than assuming:

| Route | Result |
|---|---|
| This cloud session → `192.168.0.10:22` | `UNREACHABLE` — the sandbox has allowlisted egress to package registries only; your home LAN is not on it and cannot be |
| Your desktop bridge → `192.168.0.10:22` | `ssh: connect to host 192.168.0.10 port 22: Network is unreachable` — that helper VM has no network stack at all, only your mounted folders |

So the credentials cannot help me, which is the one silver lining in them having
been posted. Change them anyway.

The loop that does work is the one above: you paste one command, I read one
file. The report was built specifically so that costs one round trip rather
than ten.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```

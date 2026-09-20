```
========================================================================================
GATE^FLAME — SSH LOCKOUT RECOVERY (wabapi @ 192.168.0.10)
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-PIREC | Version: 1.0 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# Getting back into the Pi

My runbook handed you a `PasswordAuthentication no` command with only a sentence
of warning in front of it. That was a bad call in a document written to be
pasted — the guard should have been in the command, not in the prose. Sorry.

**Nothing is lost.** The SD card is fine, the OS is fine, and the node-agent
install (if it got that far) is fine. Only the sshd config line is wrong.

Work down this list and stop at the first one that applies.

---

## Path A — you still have a terminal open on the Pi  ⏱ 10 seconds

Fastest by a mile. In that window:

```bash
sudo sed -i 's/^[[:space:]]*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sudo rm -f /etc/ssh/sshd_config.d/*passwordauth*.conf 2>/dev/null
sudo sshd -t && sudo systemctl restart ssh && echo RESTARTED
```

`sshd -t` first is not optional — it checks the config parses. Restarting sshd
with a broken config drops the service entirely, which turns this into Path C.

Now open a **second** terminal and prove it before closing the first:

```bash
ssh wabapi@192.168.0.10
```

Only close the original window once the second one logs in.

---

## Path B — no session, but you can reach the SD card  ⏱ 10 minutes, no monitor

This is the headless route. It uses the same mechanism Raspberry Pi Imager uses
for its own first-boot setup: a script named on the kernel command line. It runs
once as root, fixes sshd, removes its own hook, and reboots.

1. Power the Pi down. Take the SD card out, put it in your PC.

2. Windows will mount **one** partition — a small FAT one, usually `bootfs`.
   That is the right one. (It cannot see the Linux root partition; that is
   normal and not a problem here.)

3. Copy `firstrun.sh` onto that partition, at the top level.

4. Open `cmdline.txt` on that same partition **in a real text editor**
   (Notepad++ or VS Code — *not* Word). It is **one single line**. Do not add a
   line break; a wrapped `cmdline.txt` will not boot.

   Go to the very end of that one line and append a space, then:

   ```
   systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target
   ```

   If the partition has `cmdline.txt` but **no** `firmware` folder anywhere and
   the OS is older (Bullseye or earlier), use `/boot/firstrun.sh` instead. If
   you are unsure, the script figures out the boot directory for itself — the
   only thing that must be right is the path to the script in this line. Try
   `/boot/firmware/firstrun.sh` first; if the Pi comes back with SSH still
   refusing, redo this step with `/boot/firstrun.sh`.

5. Eject cleanly, put the card back, power up. Give it two boots — roughly two
   minutes. It fixes sshd, reboots itself, and comes back normal.

6. Log in:

   ```bash
   ssh wabapi@192.168.0.10
   ```

7. Check what it did — the script leaves a log on the same FAT partition:

   ```bash
   cat /boot/firmware/recovery-log.txt    # or /boot/recovery-log.txt
   ```

   Send it to me if anything still looks wrong.

**What the script actually changes**, so nothing is a surprise:

- `PasswordAuthentication yes` in `/etc/ssh/sshd_config` (original kept as
  `sshd_config.bak.recovery`)
- neutralises any drop-in under `/etc/ssh/sshd_config.d/` that says `no` —
  sshd takes the *first* value it obtains and `Include` sits at the top of the
  file, so a drop-in silently beats the main config
- writes `00-gateflame-recovery.conf`, which sorts first and therefore wins
- unmasks and enables `ssh`, and touches the `ssh` flag file
- runs `sshd -t` to prove the config parses before rebooting into it
- strips its own `systemd.run` arguments back out of `cmdline.txt`, so it runs
  exactly once (original kept as `cmdline.txt.bak.recovery`)

---

## Path C — monitor and keyboard on the Pi  ⏱ 5 minutes

If you have an HDMI cable and a USB keyboard, this is simpler than Path B. Log
in at the console as `wabapi`, then run the three commands from Path A.

---

# Then do the lockout-proof version

Once you are back in, this is how to actually turn off password auth. The whole
point is that it refuses to proceed unless a key already works.

On **wabakipi**, PowerShell:

```powershell
# 1. make a key if you do not have one
ssh-keygen -t ed25519 -C "dennis@wabakipi"

# 2. put it on the Pi (still using the password — this is the last time)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh wabapi@192.168.0.10 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. PROVE the key works, without a password, before changing anything
ssh -o PasswordAuthentication=no wabapi@192.168.0.10 "echo KEY_LOGIN_WORKS"
```

**Only if step 3 printed `KEY_LOGIN_WORKS`**, harden it — on the Pi:

```bash
sudo tee /etc/ssh/sshd_config.d/10-gateflame-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sudo sshd -t && sudo systemctl restart ssh && echo OK
```

Keep the current session open and test from a second terminal. Every time.

A drop-in beats editing the main config, by the way: it is one file to delete if
you ever need to reverse it, and a distribution upgrade will not fight you over
it.

And the password itself — `12345678` still needs changing regardless of which
path got you back in. `passwd`, on the Pi.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```

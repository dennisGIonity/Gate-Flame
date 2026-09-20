#!/bin/bash
# ========================================================================================
# GATE^FLAME — HEADLESS SSH RECOVERY
# Restores password SSH login on a Pi that was locked out by
#   PasswordAuthentication no
# set before a key was installed.
#
# Runs ONCE, as root, early in boot, with no monitor and no keyboard. It uses the
# same mechanism Raspberry Pi Imager uses for its own first-boot customisation:
# a script named on the kernel command line via systemd.run.
#
# It undoes its own cmdline.txt hook before rebooting, so it cannot loop.
# ========================================================================================
set +e
exec >/boot/firmware/recovery-log.txt 2>&1 || exec >/boot/recovery-log.txt 2>&1
echo "gateflame ssh recovery — $(date -Is 2>/dev/null)"

# The FAT partition is /boot on Bullseye and earlier, /boot/firmware on Bookworm.
BOOTDIR=/boot
[ -f /boot/firmware/cmdline.txt ] && BOOTDIR=/boot/firmware
echo "boot partition: $BOOTDIR"

CFG=/etc/ssh/sshd_config

# 1. Undo the main config line, whatever state it is in.
if [ -f "$CFG" ]; then
  cp -a "$CFG" "${CFG}.bak.recovery"
  sed -i 's/^[[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication yes/' "$CFG"
  grep -q '^PasswordAuthentication yes' "$CFG" || echo 'PasswordAuthentication yes' >> "$CFG"
  echo "main config patched"
fi

# 2. sshd takes the FIRST value it obtains, and Include sits at the top of the
#    file — so a drop-in beats the main config. A drop-in that says "no" would
#    silently defeat step 1. Neutralise any that do, then add one that wins.
if [ -d /etc/ssh/sshd_config.d ]; then
  grep -ril '^[[:space:]]*PasswordAuthentication[[:space:]]*no' /etc/ssh/sshd_config.d 2>/dev/null | while read -r f; do
    echo "neutralising drop-in: $f"
    sed -i 's/^[[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication yes/' "$f"
  done
  # 00- sorts first, so this is obtained before anything else.
  printf 'PasswordAuthentication yes\nKbdInteractiveAuthentication yes\n' \
    > /etc/ssh/sshd_config.d/00-gateflame-recovery.conf
  echo "recovery drop-in written"
fi

# 3. Make sure the service is actually enabled and not socket-masked.
systemctl unmask ssh 2>/dev/null
systemctl unmask ssh.socket 2>/dev/null
systemctl enable ssh 2>/dev/null
touch "$BOOTDIR/ssh"          # the classic "enable sshd" flag file
echo "ssh enabled"

# 4. Prove the config parses. A syntax error here means sshd will not start at
#    all, which would turn a lockout into a worse lockout.
if command -v sshd >/dev/null 2>&1; then
  sshd -t 2>&1 && echo "sshd config parses OK" || echo "WARNING: sshd -t reported a problem"
elif [ -x /usr/sbin/sshd ]; then
  /usr/sbin/sshd -t 2>&1 && echo "sshd config parses OK" || echo "WARNING: sshd -t reported a problem"
fi

# 5. Remove our own hook from cmdline.txt so this runs exactly once.
CMD="$BOOTDIR/cmdline.txt"
if [ -f "$CMD" ]; then
  cp -a "$CMD" "${CMD}.bak.recovery"
  sed -i 's# systemd.run=[^ ]*##g; s# systemd.run_success_action=[^ ]*##g; s# systemd.unit=[^ ]*##g' "$CMD"
  echo "cmdline.txt restored to:"
  cat "$CMD"
fi

sync
echo "recovery complete — rebooting"
sleep 2

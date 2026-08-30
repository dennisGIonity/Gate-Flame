# Outstanding actions — only you can do these

Everything below needs your hands, your passphrase, or your account — not
mine. Grouped by urgency. Exact commands included so there's nothing to
remember, just paste and run.

---

## 1. Blocking right now — git push, Pi access, GitHub CLI

**Symptom:** every attempt to push or reach the Pi fails with "Could not
open a connection to your authentication agent." Checked again just now,
same result. Whatever loaded the key before either didn't take or didn't
persist to a new shell.

**Fix — SSH key:**
```
C:\Users\DGMic\GATEFLAME-load-ssh-key.cmd
```
Double-click it or run it from a terminal, enter the passphrase when asked.
Do this **once per Windows restart** — it doesn't persist across reboots.

**Verify it actually took**, before telling me it's done — open a fresh
terminal (not the one you ran the .cmd in) and run:
```
& 'C:\Program Files\Git\bin\bash.exe' -lc 'ssh-add -l'
```
It should list a key, not say "Could not open a connection." If it still
fails from a *new* window, the key loaded into a shell-local agent instead of
the Windows SSH agent service — tell me and we'll look at why.

**Fix — GitHub CLI (separate from the SSH key):**
```
gh auth login
```
Choose: **GitHub.com** → **HTTPS** → **Login with a web browser**. It gives
you a one-time code and opens your browser — approve it there. Verify with:
```
gh auth status
```
It should say you're logged in, not "You are not logged into any GitHub
hosts."

**Once both of those are actually confirmed**, tell me — I have four commits
sitting local-only on `fix/mobile-dns-drops` (`dd76ec7`, `43f5b249`,
`407380d`, `8ffb3b4`) and I'll push all of them, which lands them straight
in PR #3 (already open, no new PR needed).

---

## 2. Yours to decide, once push works

**Merge PR #3.** It's real, on the canonical repo, 32 commits, still open,
`fix/mobile-dns-drops → main`. Merging 32 commits into `main` is a call I'll
leave to you rather than do on your behalf even with access — either merge
it yourself on github.com/dennisGIonity/Gate-Flame/pull/3, or tell me
explicitly to do it and I will.

**Fork the blocklist repo**, if you still want it under your own account
(this was item 4 from a few messages back — I ended up using zachlagden's
list directly without forking it, since forking never actually widened what
we could pull from). Only do this if you specifically want your own copy on
GitHub for some other reason:
```
gh repo fork zachlagden/Pi-hole-Optimized-Blocklists --clone=false
```

---

## 3. Security cleanup — carried over, still not done

These were flagged as live/plaintext exposure in an earlier session and
haven't been actioned:

- **Revoke both old GitHub Personal Access Tokens** and the **`GEMINI_API_KEY`**
  that leaked into the repo history earlier this project's life. Go to
  github.com/settings/tokens and the Gemini API console respectively, revoke,
  issue fresh ones only if something still needs them.
- **Back up `C:\Users\DGMic\.gateflame-signing\gateflame-release.jks`.**
  This is the Android release signing keystore — if this machine dies and
  it's never been copied anywhere else, every future app update needs Google
  Play's key-recovery process instead of a normal release. Copy it to at
  least one other location (a password manager's file storage, an encrypted
  USB drive kept somewhere else) today, not "eventually."

---

## 4. Before the app can go on the Play Store

All of this was already flagged in the roadmap doc — repeating here as one
list since you'll hit all of it in sequence when you're ready to ship:

- `android/keystore.properties` (or the `GATEFLAME_KEYSTORE_*` environment
  variables) still isn't set up, so `npm run build:apk` can't produce a
  signed release build yet — only debug builds work today.
- **Enrol in Play App Signing** at your very first upload — it's the only
  recovery path if the upload key is ever lost later.
- **A public privacy-notice URL** — POPIA requires one regardless, and Play
  won't accept a listing without one.
- **Fill in the Data Safety form honestly** — the real answer here (almost
  nothing leaves the LAN) is unusually strong, worth using as a selling
  point rather than treating as a compliance chore.
- **`android/version.properties` vs the `v1.0.2` git tag disagreement**
  (currently `VERSION_NAME=1.0.1`) needs settling before the first upload —
  Play rejects a reused version code.
- **Check the current closed-testing tester-count/duration rule** on the
  Play Console before planning a launch date — this has added weeks to other
  projects when checked too late.

---

## 5. Whenever you're ready to spend real infrastructure money (or use the free tier)

**Deploy the Shield control plane for real.** Nothing here is code Claude
still owes you — the whole thing is written and tested, it's just never been
run against a live server. Full commands are in
`infra/headscale/README.md`. Short version: stand up Headscale on any small
box (even this machine via Docker), then register at least one exit node —
Oracle Cloud's Always Free tier is the R0 option, one country per Oracle
account, real caveats spelled out in that doc.

**Test the new Shield UI on an actual phone.** The continent picker and the
share-sheet handoff (instead of a raw file download) were verified by
type-checking, not by running on a real Android/iOS build — I flagged this
plainly in `docs/VPN-SHIELD-DESIGN.md`. Worth a real on-device pass before
it reaches a customer, specifically: does the share sheet actually list an
installed OpenVPN app, does it look right.

---

## Already done — nothing left for you here

- Windows Firewall rule for the fleet dashboard (port 8080) — confirmed
  present and working, dashboard answers on `http://192.168.0.6:8080`.
  **Double check the 443 rule landed too** — your paste cut off mid-command
  last time:
  ```
  New-NetFirewallRule -DisplayName "Ionity Local Drive (443)" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Private
  ```
- The fleet dashboard's real LAN address is `192.168.0.6`, not the `.7`
  the project notes used to say — that stale address was the actual reason
  it looked unreachable for so long, not the firewall.

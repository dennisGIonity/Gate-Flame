```
========================================================================================
GATE^FLAME — ACTION SHEET FOR DENNIS
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-015-ACT | Version: 1.0 | Updated: 2026-08-15 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: INTERNAL | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# The things only you can do

Everything on the 12-item queue that could be done in code **is done and
committed**. What is below needs your GitHub login, your machine, or your
signature — a session has none of those.

**Do them in this order.** Steps 1–3 are one sitting, about ten minutes.

---

## 0. What you have

```
C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\
  gateflame-2026-08-15-FINAL.bundle     ← tip 13680e7, 5 commits, USE THIS
  gateflame-2026-08-15-checkpoint.bundle   superseded (tip 6a8e1ba)
  gateflame-node-agent-and-pairing.bundle  superseded (tip 919856a)
  gateflame-branch.bundle                  superseded (tip 90c6757, already pushed)
```

The FINAL bundle was verified by cloning it from scratch and re-running all
465 tests from the clone — not from the working copy that built it.

| Commit | What |
|---|---|
| `919856a` | node-agent rebuild + pairing UI *(already in your local repo, not pushed)* |
| `d5a1bcd` | applicationId frozen as `today.ionity.gateflame` |
| `6a8e1ba` | nftables bouncer, keystore generator, Pi validator |
| `1cf9b10` | DPI, WAN budget, zero-trust posture, feed-receiver |
| `13680e7` | code-splitting, 72 frontend tests, polling-loop fix, POPIA review, SECURITY.md |

---

## 1. Apply the bundle and push  ⏱ 2 min

```bash
cd C:\Users\DGMic\GateFlame-Repo
git fetch "C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-2026-08-15-FINAL.bundle" chore/repo-hygiene:chore/repo-hygiene --force
git push origin chore/repo-hygiene
```

Fast-forwards the remote branch `90c6757 → 13680e7` and updates **PR #1**
automatically. CI (`ci.yml`) will run on the push — it now also asserts the
applicationId agrees in all five places.

**Verify before moving on:**

```bash
git log --oneline -5 chore/repo-hygiene     # tip should be 13680e7
git ls-remote origin chore/repo-hygiene     # remote should match
```

## 2. Merge PR #1  ⏱ 1 min

<https://github.com/dennisGIonity/Gate-Flame/pull/1>

Wait for CI green, then **Squash and merge** or **Merge** — your preference;
the commit messages are written to survive either.

**Why this one matters most:** `main` is still `86deb08`, which means the
public default branch is *right now* serving the corrupt 1.2 MB tarball and
the dev-mode bundles that leak the internal path `/app/applet/src/…`. This
merge is the only thing that removes them.

## 3. Delete the duplicate folder  ⏱ 30 sec

```
C:\Users\DGMic\GateFlame-Repo\_fix-2026-08-13\
```

A copy of the backup folder that ended up inside the repo working tree. The
bridge is read-append only so a session cannot remove it. It is gitignored,
so it is harmless — just clutter.

---

## 4. Revoke the two GitHub PATs  ⏱ 2 min  🔴 SECURITY

Two live tokens (a classic `ghp_…` and a fine-grained `github_pat_…`) were
pasted into chat on 2026-08-14.

- <https://github.com/settings/tokens>
- <https://github.com/settings/personal-access-tokens>

**A credential that passed through a session transcript is compromised
whether or not anyone used it.** Generate a fresh one locally if you need it,
and let git's credential prompt hold it — never paste it into a chat again.

## 5. Revoke `GEMINI_API_KEY`  ⏱ 2 min  🔴 SECURITY

<https://aistudio.google.com/apikey>

Then delete:

```
C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\ROTATE-ME.txt
```

All 14 `.env` files were scrubbed to the placeholder on 2026-08-13 and the
app never read the key. Only the revoke is left — and it needs your Google
login, which is why it has stayed open for two days.

---

## 6. Generate the release keystore  ⏱ 10 min  🔴 BLOCKS EVERY APK

**Nothing signable exists until you do this, and it has no recovery path.**

```powershell
cd C:\Users\DGMic\GateFlame-Repo\android
.\generate-keystore.ps1
```

(or `bash generate-keystore.sh` under WSL/Git Bash)

The script refuses to run in a container or CI and explains why — a key born
in an ephemeral container and passed through a chat transcript is already
disclosed, which is exactly why no session generated one for you. It prompts
for passwords rather than taking them on the command line (argv is visible in
`ps` and shell history), creates RSA 4096 with 30-year validity, then proves
the private key actually unlocks rather than just that a file exists.

**Then back it up 3-2-1 before the first unit ships.** If this key is lost
after shipping, no fielded node can ever receive a security update again —
Android will not accept an APK signed by a different key, and re-pairing
wipes node state. It is the single most valuable file in the project.

Afterwards:

```bash
npm run build:apk        # bumps versionCode, builds, signs, fingerprints
```

Until the keystore exists, `assembleRelease` deliberately **fails** with
"Refusing to build an UNSIGNED release" rather than quietly emitting an
unsigned APK. `npm run build:apk-debug` works today if you want something
installable on a test handset now.

## 7. Tag `v1.0.1` to publish the first Release  ⏱ 1 min

Do this **after** steps 1–2, so the tag points at merged code.

```bash
git checkout main && git pull
git tag v1.0.1 && git push origin v1.0.1
```

`release.yml` builds the tarball, verifies its gzip magic and that it
round-trips, generates `SHA256SUMS.txt`, and publishes both as Release
assets. This fixes `docs/LINKS.md` §4, which currently links to a Releases
page with nothing on it. The APK is **not** attached automatically — it is
signed on your machine, never in CI.

---

## 8. Validate on real Pi hardware  ⏱ 30 min + a Pi

Nothing in this project has ever executed on a Raspberry Pi. Every telemetry
number so far came from a container with no thermal zone, no `vcgencmd` and
no real ARP table.

```bash
cd node-agent && ./validate-on-pi.sh
```

19 read-only checks, each printing PASS/FAIL/N-A with the observed value. It
fails loudly if the model is not a Pi, because then the run proves nothing.
Grant the two capabilities in the systemd unit rather than running as root:

```ini
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
```

Without them the firewall and DPI modules report `degraded` with that exact
remedy — which is correct behaviour, not a bug.

## 9. Send the POPIA review to a practitioner  ⏱ your call

`docs/POPIA-REVIEW.md` — new, written as a hand-over rather than a substitute
for the real review. §5 has seven questions only a person can answer. The two
that need an answer soonest:

- **Where will `feeds.ionity.today` be hosted?** If it is outside South
  Africa, s72 cross-border transfer engages. Hosting it in ZA removes an
  entire condition from the analysis, and latency is irrelevant to a
  15-minute batched POST.
- **Is the Information Officer registered with the Information Regulator?**
  A form, but a prerequisite for selling to business customers.

---

## Still open after all of the above

Not blocking, but honest about what remains:

- `build-standalone.js` is still orphaned — no npm script calls it.
- The kiosk "what we send" telemetry screen is specified in
  `PAIRING-AND-TELEMETRY.md` §4.3 rule 3 but not verified as built. It is the
  visible half of a promise made to customers.
- No breach response plan exists (POPIA s22).
- No privacy notice published (POPIA s18).
- The `feed-receiver/` service is written and tested but not deployed
  anywhere — nothing is listening at `feeds.ionity.today` yet.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```

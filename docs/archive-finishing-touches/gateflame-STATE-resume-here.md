```
========================================================================================
GATE^FLAME — 📌 PINNED STATE / RESUME HERE
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-STATE | Version: 6.1 | Updated: 2026-08-18 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: PUBLIC | Building Tomorrow, Today. | Anything is Possible with God.
========================================================================================
```

# ⭐ RESUME HERE — three short things after lunch

**Updated 2026-08-18 12:10 SAST.**

The mobile app now builds, installs, launches clean and reaches the live node.
Three bugs were found and fixed today by running the APK on real hardware —
none was visible from reading the code. What remains needs a human at the box.

---

## 1. ⭐ AFTER LUNCH — three things, all short

### a. Register the SSH key so the push can happen  ⏱ 30 s

**The push is blocked on credentials, not on work.** The branch is committed
and the tree is clean; only the upload is missing.

Your key **is** offered to GitHub and rejected — `id_ed25519`
(`SHA256:8AQd4NPdbhkzEXYT4Em4Xy9Lj2wlmMZg6dYDX2lrpEI`) is not registered on the
account. Paste this at <https://github.com/settings/keys>:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILnQo9e8yMHc8S4pf79Uuy62+5xBM/e1DIlZUR93GisY dennis@wabakipi
```

Then, from `C:\Users\DGMic\GateFlame-Repo` (already checked out on the branch,
clean tree):

```cmd
git remote set-url --push origin git@github.com:dennisGIonity/Gate-Flame.git
git push -u origin fix/mobile-hookup
```

Alternative if you would rather not touch keys: `git push -u origin
fix/mobile-hookup` over the existing HTTPS remote will pop the Git Credential
Manager browser sign-in. That works too — it just cannot be driven
unattended, which is why it was left for you.

> ⚠ **Two gotchas found today, both recorded so they do not cost time twice:**
> `C:\Windows\System32\OpenSSH\ssh.exe` on this machine is **broken** — it
> produces no output even for `ssh -V`. Use
> `"C:\Program Files\Git\usr\bin\ssh.exe"`, or set
> `GIT_SSH_COMMAND` to it. Also: never run a bare `git push` here without
> `GIT_TERMINAL_PROMPT=0` when unattended — it hangs forever on the
> credential prompt rather than failing.

### b. Plug the S10e in

Screen unlocked, same Wi-Fi as the node. Serial `RF8M22NV4XB`; adb is already
authorised, so no new prompt. Then the fixed APK gets installed and discovery
runs on real hardware.

### c. Issue a pairing code ON THE PI

Cannot be done remotely, by design — `kiosk` scope is synthesised from a
loopback source address and never from a bearer token, which is exactly what
makes pairing require physical presence:

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/pair/request
```

Returns a 6-digit code and an expiry. Hand over the code, the claim gets
driven from the app, and the dashboard is verified switching from demo to live
Pi-hole numbers.

> ⚠ `provisioned: false` — this node has **never been paired**. Per the
> contract the first successful claim also arms first-boot admin. Worth
> knowing before, not after.

---

## 2. Where the code is

| | |
|---|---|
| Branch | `fix/mobile-hookup` @ `c0c7563`, **local only** |
| Checked out | Yes — `C:\Users\DGMic\GateFlame-Repo`, clean tree |
| Bundle backup | `C:\Users\DGMic\GateFlame-Backup-2026-08-13\_fix-2026-08-13\gateflame-mobile-fixes.bundle` |
| Base | `main` @ `031a5bc` |
| Built APK | `android\app\build\outputs\apk\debug\app-debug.apk` — 4,598,674 bytes, 12:04, **contains all three fixes** |

## 3. The live node

| | |
|---|---|
| nodeId | `GF-72TYTITQ` |
| agentVersion | `0.1.0` |
| provisioned | **false** — never paired |
| Addresses | `192.168.0.13` **and** `192.168.0.10` — verified same node, the Pi is dual-homed (Ethernet + Wi-Fi). Both answer, as does `gateflame.local:8080` via mDNS |
| Pi host | `raspberrypi`, user `wabapi` (**not** `pi` — that is why SSH-as-pi fails) |
| SSH PC → Pi | not set up, no key |

`gateflame.local:8080` is the first discovery candidate and resolves, so
automatic discovery works — no need to pin `VITE_NODE_BASE_URL`.

## 4. Three bugs fixed today

| Commit | Bug |
|---|---|
| `73e3056` | Import cycle killed the app on launch |
| `c0c7563` | App could not reach a node at all; revocation was ignored |

**Import cycle** — `gateflameApi → mockAdapter → serviceManager → gateflameApi`.
`mockAdapter` read `SECURITY_MODULES` at module-evaluation time, so evaluation
order decided whether the binding existed. The APK painted, then died:
`Uncaught ReferenceError: Cannot access 'je' before initialization`. Latent for
two commits; the `manualChunks` vendor split changed the order and detonated
it — the split exposed the bug, it did not create it. Fixed structurally: the
catalogue moved to `src/services/securityModules.ts`, a leaf importing nothing.
`src/services/importCycles.test.ts` fails on **any** cycle in `src/` and prints
the path; verified non-vacuous by reintroducing the old import.

**Mixed content — self-inflicted, and it shipped.** Commit `7de065e` set
`allowMixedContent: false` claiming `network_security_config.xml` replaced it
more narrowly. Category error, which survived review because both say
"cleartext":

- network_security_config → may the **platform** open an `http://` socket.
- mixed-content mode → may a page loaded over **https://** fetch `http://`.

Capacitor serves from `https://localhost`, so every node call *is* mixed
content. No network config can permit that; only `setMixedContentMode` can.
The flag removed the product's only function. Now `true`, reasoning recorded
in `capacitor.config.ts`. RFC1918 narrowing was never in that flag —
`assertPrivateHost()` enforces it per request and the node gates on source
address independently.

**Revocation was invisible on the handset.** `main-mobile` read `hasToken()`
once at mount and nothing handled a 401, so a revoked phone kept its dead
token, retried every 4 s, and logged `401` to a console no customer can open.
An *authenticated* 401 now clears the token and returns to pairing. Narrow on
purpose: `pair/claim` returns 401 for a wrong code (must not wipe a good
token) and 403 means insufficient scope (must not sign the user out).

117 frontend tests pass. `tsc` clean.

## 5. ⚠ Both build machines are misconfigured, in opposite directions

Silent, and it will keep producing wrong artifacts until fixed.

| Machine | Problem | Symptom |
|---|---|---|
| **wabakipi** (Windows) | `NODE_ENV=production` **and** npm `omit=dev` | `npm ci` installs 136 packages instead of 324; TypeScript missing, so `cap sync` fails outright |
| **raspberrypi** | `NODE_ENV=development` | Produces **React development bundles** — `vendor-react` 404,596 bytes instead of 200,059, ~2×, leaking dev internals. A recurrence of the exact defect the 2026-08-13 audit found in the committed bundles |

Build with `set NODE_ENV=` / `unset NODE_ENV` until the environment is cleaned.
Check any build:

```bash
ls -l dist-*/assets/vendor-react.*.js                            # ~200 kB = prod, ~400 kB = dev
grep -c 'Minified React error' dist-*/assets/vendor-react.*.js   # >0 = production
grep -c 'unique "key" prop'    dist-*/assets/vendor-react.*.js   # >0 = DEV, wrong
```

## 6. The working Windows build recipe

`C:\Users\DGMic\GateFlame-Repo` **had vanished** and was re-cloned from GitHub.
Two JDKs are already present; nothing needs installing.

```cmd
cd /d C:\Users\DGMic\GateFlame-Repo
set NODE_ENV=
npm ci --include=dev --no-audit --no-fund
npm run build:html-mobile
npx cap sync android
cd android
set JAVA_HOME=C:\Users\DGMic\.gradle\jdks\eclipse_adoptium-21-amd64-windows.2
set ANDROID_HOME=C:\Users\DGMic\AppData\Local\Android\Sdk
gradlew.bat assembleDebug --console=plain
```

Install → `adb -s RF8M22NV4XB install -r -d <apk>`. Debug appId is
`today.ionity.gateflame.debug`, so it coexists with a release build.

`npm run build:apk-debug` does **not** work in cmd — the script uses `chmod`
and `./gradlew`. Use the steps above.

**Do not test in BlueStacks.** `emulator-5554` is BlueStacks, not an AVD: it
NATs (cannot see the LAN or mDNS), runs Android 9 x86_64, and its foreground is
a game. Useful only to prove the bundle initialises.

## 7. Since v5.0 — what landed while I was away

`main` moved `86deb08 → 031a5bc` and all earlier work of mine is merged. Also
done: Pi-hole + Unbound actually filtering, DNS bypass mode, content/threat
filtering split, pause-with-expiry, threat log on the live Pi-hole v6 API, a
kiosk console, CI running 548 tests and booting the agent, and the 36 root
codemod scripts deleted (audit item 16). `v1.0.2` tagged. Earlier branch is
PR #2 at `77f4819`.

**Queue item 3 is DONE** — `C:\Users\DGMic\.gateflame-signing\gateflame-release.jks`
exists; the keystore generator was run. A **signed release** APK is therefore
possible and needs only the passwords, which are Dennis's. Debug builds need
nothing.

## 8. Still open

- **Push `fix/mobile-hookup`** — see §1a. Blocked on credentials only.
- **Signed release APK** — needs `android/keystore.properties` or the
  `GATEFLAME_KEYSTORE_*` env vars.
- **OEM unlocking is ON** on the S10e (`sys.oem_unlock_allowed=1`). Knox
  intact (`flash.locked=1`, `verifiedbootstate=green`) but the safety catch is
  off. Turning it off may require a 7-day wait to re-enable — relevant if
  LineageOS is still wanted.
- Kiosk "what we send" telemetry screen — specified in
  `PAIRING-AND-TELEMETRY.md` §4.3 rule 3, still unverified as built.
- `feed-receiver/` written and tested, deployed nowhere.
- POPIA: Information Officer registration, privacy notice, breach plan, and the
  hosting location of `feeds.ionity.today` (s72). See `docs/POPIA-REVIEW.md` §5.
- S10e: two Google accounts still need the **"Account action required"** tap
  (`UNAUTHENTICATED` was 30 → 11; the token-store corruption is fixed at 0).

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```

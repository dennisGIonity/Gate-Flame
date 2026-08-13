```
========================================================================================
GATE^FLAME — ANDROID RELEASE SIGNING RUNBOOK
Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
Document ID: DOC-2026-08-013-SIGN | Version: 1.0 | Updated: 2026-08-13 SAST
Governance: Policy 986 AED | License: AED 900 | CC BY-NC-SA 4.0 where stated
(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
Web: https://www.ionity.today | https://www.ionity.world | Ref: https://www.ionity.co.za
Classification: CONFIDENTIAL — handling instructions inside | Building Tomorrow, Today.
========================================================================================
```

# Release signing — do this before the first unit ships

## Why this is urgent, and why it is different from every other task

An Android app's identity is its **signing key**, not its name or its version.
Android will not install an update signed by a different key than the one already
on the device — it refuses, with no override.

So if a Gate^Flame node goes out the door with a debug-signed APK, and you later
switch to a proper release key, **every customer in the field must uninstall and
re-pair.** For an appliance sold as a sealed product, that is a support event per
unit, and it is entirely avoidable by spending twenty minutes now.

The keystore also **cannot be regenerated.** There is no reset, no recovery, no
support ticket that gets it back. Lose the file or forget the password and the app
is permanently unupdatable — the only path is a new `applicationId`, which is a new
app, which means every customer reinstalls anyway.

> **This is the one artifact in the whole project with no recovery path.**
> The corrupt release tarball was rebuildable. The lost backend was rebuildable
> from its spec. A lost keystore is not rebuildable by anyone, ever.

## Step 1 — generate it (once, on a machine you control)

Run this on `wabakipi`, not in a cloud session, not in a container. The key must
never exist anywhere you do not physically control.

```bash
keytool -genkeypair -v \
  -keystore gateflame-release.jks \
  -alias gateflame \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10950 \
  -dname "CN=Gate^Flame, OU=AEDI, O=Ionity (Pty) Ltd, L=Centurion, ST=Gauteng, C=ZA"
```

- `-validity 10950` is 30 years. Google Play requires a key valid past 2033;
  a key that expires mid-product-life strands the app exactly as losing it would.
- `-keysize 4096` — this key outlives the hardware it signs for.
- You will be prompted for a store password and a key password. **Use two
  different, long, randomly generated passwords.** Put them in your password
  manager as you create them, not afterwards.

## Step 2 — back it up before you use it

Three copies, two media types, one off-site. Do this *before* the first signed
build, because the window where losing it is cheap closes the moment an APK ships.

| Copy | Where | Notes |
|---|---|---|
| 1 | Encrypted volume on `wabakipi` | Working copy |
| 2 | Offline encrypted USB, in a safe | Not in the same building as 1 |
| 3 | Company password manager as a file attachment, or a sealed envelope with a printed base64 dump | Survives loss of both machines |

Store the two passwords **separately from the keystore file**. A backup containing
both is a single point of compromise rather than a single point of recovery.

Record the SHA-256 fingerprint somewhere durable now:

```bash
keytool -list -v -keystore gateflame-release.jks -alias gateflame | grep SHA256
```

## Step 3 — wire it up locally

Put the keystore **outside the repository** — the `.gitignore` covers the obvious
names, but the safest file is one git can never see:

```
C:\Users\DGMic\.gateflame-signing\gateflame-release.jks
```

Then create `android/keystore.properties` (gitignored):

```properties
storeFile=../../.gateflame-signing/gateflame-release.jks
storePassword=<store password>
keyAlias=gateflame
keyPassword=<key password>
```

`storeFile` is resolved relative to the `android/` directory.

Confirm it never becomes trackable:

```bash
git check-ignore -v android/keystore.properties     # must print a .gitignore rule
git status --short                                  # must not list it
```

## Step 4 — build and verify

```bash
npm run build:apk
```

That bumps `versionCode`, builds the web bundle, syncs Capacitor, runs
`assembleRelease`, copies the APK to `release/GateFlame-Mobile.apk`, and prints
the signing fingerprint.

**Compare the fingerprint against the one you recorded in Step 2.** If it differs,
stop — you have signed with the wrong key, and shipping it would strand every
device already in the field.

The Gradle build **refuses** to produce an unsigned release rather than silently
falling back to the debug key. If you genuinely want an unsigned artifact:

```bash
cd android && ./gradlew assembleRelease -PallowUnsignedRelease=true
```

## Step 5 — CI (optional, and safer than it sounds)

CI never reads `keystore.properties`. It reads environment variables, so nothing
is written to a runner's disk:

| Variable | Value |
|---|---|
| `GATEFLAME_KEYSTORE_PATH` | Path the workflow decodes the keystore to |
| `GATEFLAME_KEYSTORE_PASSWORD` | Store password |
| `GATEFLAME_KEY_ALIAS` | `gateflame` |
| `GATEFLAME_KEY_PASSWORD` | Key password |

Store the keystore itself as a base64 GitHub secret
(`base64 -w0 gateflame-release.jks`), decode it into the runner's temp directory
at build time, and let the job delete it on exit. GitHub masks secret values in
logs, but **never `echo` them** — masking is a safety net, not a control.

## Handling rules

1. **Never** commit the keystore or `keystore.properties`. `.gitignore` covers
   `*.jks`, `*.keystore`, `keystore.properties`, `upload-keystore*`,
   `release-keystore*` and `play-service-account*.json`.
2. **Never** paste the keystore, its base64, or either password into a chat
   window, an AI session, a ticket, or an email. Anything pasted into a
   transcript should be treated as disclosed.
3. **Never** email it to yourself "temporarily".
4. Rotate the *passwords* only through `keytool -storepasswd` / `-keypasswd`.
   The **key itself is never rotated** — that is the whole point of it.
5. When someone with access leaves, the passwords change. The key does not.

## If the worst happens

There is no recovery. The only path forward is a new `applicationId`, published as
a new app, with every customer reinstalling and re-pairing. Plan the comms, not
the fix.

This is exactly why Step 2 comes before Step 4.

```
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM2
Governance: Policy 986 AED | Building Tomorrow, Today.
```

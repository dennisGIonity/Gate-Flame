"""Gate^Flame node-agent.

Runs on the Pi appliance. Owns pairing, telemetry, threat visibility, client
listing and module (service) control, per docs/PAIRING-AND-TELEMETRY.md in the
main repo.

Scope note: this is a from-scratch rebuild after the previous implementation
(commit a4cf2c1, ~15,000 insertions across nine modules) was lost to an
unpushed branch in an ephemeral session. This rebuild implements the full
pairing/security contract and the API surface the UI already calls, with a
smaller, honestly-reported set of telemetry/module sources than the original
nine-module design. Where a capability isn't wired up yet (DPI, nftables
bouncer, WAN budget accounting), the module reports `status: "not_implemented"`
with a named gap — never a faked "running".
"""

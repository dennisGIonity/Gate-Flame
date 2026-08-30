# Gate^Flame Shield — control plane + regions, on a real R0 budget

Two different things, two different costs. Keep them separate in your head:

1. **The control plane (Headscale)** — coordinates devices, hands out peer
   configs, knows which exit node is in which country. Runs on one small box.
   Free forever: it's ~50MB of RAM, a SQLite file, and can live on hardware
   you already have (even the same Pi as the DNS stack, or Dennis's own
   Windows machine via WSL/Docker) if you don't want to spend anything on
   this part at all.

2. **Exit nodes** — one small server PER COUNTRY you want to offer, because
   that server's IP is what makes a connection look like it's coming from
   that country. This is the part that normally costs money — a VPS in the
   UK, one in Germany, one in the US, and so on.

## The zero-budget path for (2), honestly assessed

There is no way to get real server presence in another country for free that
doesn't have a real catch. Here they are, catches included:

**Oracle Cloud "Always Free" tier — the strongest option.**
Unlike AWS/GCP/Azure's free tiers (12 months, then billed, and they ask for a
card up front), Oracle's Always Free compute genuinely never expires and
genuinely never bills you as long as you stay inside it: 4 ARM Ampere OCPUs +
24GB RAM (splittable across up to 4 instances) plus 2 tiny AMD instances, per
account, forever. Plenty for a WireGuard exit node, which is nearly idle CPU.

The catch: **one Oracle account gets Always Free resources in ONE region**,
chosen at signup (their signup lets you pick nearly any region regardless of
where you actually are — it does not have to match your billing address
country). So one account = one country, for real, for free.

Getting to *multiple* countries for free means multiple Oracle accounts —
which works today, but leans on their signup allowing it rather than being a
feature designed for this, and Oracle does watch for and periodically purge
accounts it decides are abusive/duplicate. Don't build the business on the
assumption this stays available forever; treat every country you get this way
as a bonus, not a guarantee. If it ever gets shut down, that region just goes
back to reg.regions[].available: false in the app — nothing breaks, it
degrades honestly (see vpn.py).

**The real zero-cost path once there are customers: community exit nodes.**
Longer-term and the actually sustainable version of "free": once Ionity has
paying customers in more than one country, their OWN Gate^Flame boxes could
volunteer (explicit opt-in only, probably a premium perk or bill credit) to
act as an exit node for others. Real zero marginal infrastructure cost,
scales with the customer base instead of your wallet. Real things to solve
before shipping this, not later: their home ISP's acceptable-use policy may
not allow running as a VPN exit at all, and someone else's traffic exiting
through a customer's home IP is a genuinely different liability and abuse
conversation than a private point-to-point tunnel — needs its own consent
flow and a way to immediately kill a misbehaving exit, not a checkbox
buried in settings. Don't build this without solving abuse-reporting first.

**What this means for launch:** start with ONE region on ONE Oracle Always
Free account — South Africa if Oracle offers a nearby region, otherwise
whichever region has the best latency to your actual customers — prove the
whole Shield flow works end to end for real, and add regions as either more
free-tier accounts or real budget become available. The code has no opinion
on how many regions exist; `vpn.list_regions()` just reports whatever is
actually registered and reachable.

## One-time setup (once you have a box for the control plane)

```bash
cd infra/headscale
mkdir -p config data
# minimal config.yaml - see Headscale's own docs for the full reference:
# https://headscale.net/stable/ref/configuration/
docker compose up -d
docker exec gateflame-shield-control headscale users create gateflame
docker exec gateflame-shield-control headscale apikeys create --user gateflame
# ^ this key is GATEFLAME_HEADSCALE_API_KEY on the node-agent side
```

## Adding one region's exit node (repeat per country)

On the exit-node VPS itself (Oracle instance, or wherever):

```bash
curl -fsSL https://tailscale.com/install.sh | sh   # ships the WireGuard-compatible client
tailscale up --login-server https://<your-headscale-host>:8080 \
  --advertise-exit-node \
  --advertise-tags=tag:region-uk        # the code Ionity chose for this country
```

Approve the new node and its tag once from the control-plane host:

```bash
docker exec gateflame-shield-control headscale nodes list
docker exec gateflame-shield-control headscale nodes tag -i <node-id> -t tag:region-uk
```

That's the entire "add a country" workflow — nothing on the Gate^Flame box or
in the mobile app needs a code change. `vpn.list_regions()` reads the tag
straight off the live node list.

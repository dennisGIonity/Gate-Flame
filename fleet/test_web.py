"""Web surface of the fleet dashboard: login/session, path prefix, headers,
ingest validation. Each test names the failure it pins.

Run: python -m pytest -q   (from fleet/)
"""
import base64
import ipaddress
import json
import re

import pytest
from fastapi.testclient import TestClient

import app as fleet


def _pin(monkeypatch, tmp_path):
    """Every setting app.py reads from the environment, pinned to its default.
    A shell that has sourced fleet.env.ps1 (or set any GATEFLAME_FLEET_* knob)
    must not be able to change a verdict here - it used to: with the admin
    user set, test_history failed; with ROOT_PATH/TRUSTED_PROXIES/COOKIE_SECURE
    set, 19 tests in this file did."""
    monkeypatch.setattr(fleet, "DB_PATH", str(tmp_path / "fleet.db"))
    monkeypatch.setattr(fleet, "ADMIN_USER", "admin")
    monkeypatch.setattr(fleet, "ADMIN_PASSWORD", "test-pw")
    monkeypatch.setattr(fleet, "ENROL_TOKEN", "enrol-secret")
    monkeypatch.setattr(fleet, "ROOT_PATH", "")
    monkeypatch.setattr(fleet, "_TRUSTED", fleet._parse_trusted("127.0.0.1,::1"))
    monkeypatch.setattr(fleet, "COOKIE_SECURE", "auto")
    monkeypatch.setattr(fleet, "SESSION_HOURS", 12.0)
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 8)
    monkeypatch.setattr(fleet, "LOGIN_WINDOW_SECONDS", 900)
    monkeypatch.setattr(fleet, "STALE_AFTER_SECONDS", 1800)
    monkeypatch.setattr(fleet, "RAW_RETENTION_DAYS", 7)
    monkeypatch.setattr(fleet, "HOURLY_RETENTION_DAYS", 90)
    monkeypatch.delenv("GATEFLAME_FLEET_SESSION_SECRET", raising=False)
    fleet.login_limiter.reset()
    fleet._payload_cache.clear()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    _pin(monkeypatch, tmp_path)
    with TestClient(fleet.app, base_url="http://testserver", client=("127.0.0.1", 50000)) as c:  # runs the lifespan
        yield c
    fleet.login_limiter.reset()


@pytest.fixture()
def client_from(tmp_path, monkeypatch):
    """A client whose TCP peer is the given address - for proxy-trust tests."""
    _pin(monkeypatch, tmp_path)
    opened = []

    def make(peer):
        c = TestClient(fleet.app, base_url="http://testserver", client=(peer, 40000))
        c.__enter__()
        opened.append(c)
        return c

    yield make
    for c in opened:
        c.__exit__(None, None, None)
    fleet.login_limiter.reset()


def cookie_attrs(set_cookie: str) -> dict:
    """Attributes of a Set-Cookie header, {lower-cased name: value}. Checking
    names, not substrings, so a cookie VALUE can never satisfy `"secure" in`."""
    out = {}
    for part in set_cookie.split(";")[1:]:
        k, _, v = part.strip().partition("=")
        out[k.lower()] = v
    return out


def basic(pw="test-pw"):
    return {"Authorization": "Basic " + base64.b64encode(f"admin:{pw}".encode()).decode()}


def login(c, pw="test-pw", headers=None, prefix=""):
    return c.post(prefix + "/login", content=f"username=admin&password={pw}",
                  headers={"Content-Type": "application/x-www-form-urlencoded", **(headers or {})},
                  follow_redirects=False)


def post_health(c, node="GF-T1", token="enrol-secret", body=None, prefix=""):
    body = body if body is not None else {"nodeId": node, "agentVersion": "1.1.0", "host": {"cpuPercent": 5.0},
                                          "modules": [], "piholeReachable": True}
    return c.post(f"{prefix}/api/v1/nodes/{node}/health", headers={"Authorization": f"Bearer {token}"},
                  content=body if isinstance(body, (bytes, str)) else json.dumps(body))


# ------------------------------------------------------------ lifespan

def test_lifespan_refuses_to_start_without_secrets(monkeypatch, tmp_path):
    monkeypatch.setattr(fleet, "DB_PATH", str(tmp_path / "x.db"))
    monkeypatch.setattr(fleet, "ENROL_TOKEN", "enrol-secret")  # so it is the PASSWORD check that refuses
    monkeypatch.setattr(fleet, "ADMIN_PASSWORD", "")
    with pytest.raises(RuntimeError):
        with TestClient(fleet.app):
            pass


# ------------------------------------------------------------ pages never 401

def test_dashboard_without_session_redirects_to_login_not_401(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/login"


def test_login_page_renders_with_base_href(client):
    r = client.get("/login")
    assert r.status_code == 200
    assert '<base href="/">' in r.text
    assert 'action="login"' in r.text


def test_login_sets_strict_httponly_cookie_and_dashboard_loads(client):
    r = login(client)
    assert r.status_code == 303 and r.headers["location"] == "/"
    sc = r.headers["set-cookie"].lower()
    assert "httponly" in sc and "samesite=strict" in sc and "path=/" in sc
    assert "secure" not in cookie_attrs(sc)  # plain http: a Secure cookie would never come back
    assert "strict-transport-security" not in r.headers  # HSTS over plain http is meaningless
    page = client.get("/")
    assert page.status_code == 200 and "assets/app.js" in page.text


def test_cookie_is_secure_when_proxy_says_https(client):
    r = login(client, headers={"X-Forwarded-Proto": "https"})
    assert "secure" in cookie_attrs(r.headers["set-cookie"])
    assert "strict-transport-security" in r.headers


def test_bad_password_redirects_back_with_message(client):
    r = login(client, pw="nope")
    assert r.status_code == 303 and r.headers["location"] == "/login?e=bad"
    assert "set-cookie" not in r.headers
    assert "did not match" in client.get("/login?e=bad").text


def test_logout_clears_cookie(client):
    login(client)
    r = client.post("/logout", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login?e=out"
    client.cookies.clear()
    assert client.get("/api/v1/nodes").status_code == 401


def test_tampered_or_expired_session_is_refused(client, monkeypatch):
    client.cookies.set(fleet.COOKIE_NAME, fleet.make_session("admin") + "x")
    assert client.get("/api/v1/nodes").status_code == 401
    client.cookies.set(fleet.COOKIE_NAME, fleet.make_session("admin", now=1000.0))
    assert client.get("/api/v1/nodes").status_code == 401


def test_changing_the_password_signs_existing_sessions_out(client, monkeypatch):
    login(client)
    assert client.get("/api/v1/nodes").status_code == 200
    monkeypatch.setattr(fleet, "ADMIN_PASSWORD", "rotated")
    fleet._session_key.cache_clear()
    assert client.get("/api/v1/nodes").status_code == 401


# ------------------------------------------------------------ API auth

def test_unauthenticated_api_is_401_json_without_basic_challenge(client):
    """A Basic challenge on a browser fetch pops the browser's own login box."""
    r = client.get("/api/v1/nodes")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/json")
    assert "www-authenticate" not in r.headers


def test_basic_auth_still_works_for_scripts(client):
    assert client.get("/api/v1/nodes", headers=basic()).status_code == 200
    r = client.get("/api/v1/nodes", headers=basic("wrong"))
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Basic"


def test_cookie_writes_need_the_csrf_header(client):
    post_health(client)
    login(client)
    body = {"label": "x", "tags": [], "billingState": "trial"}
    assert client.put("/api/v1/nodes/GF-T1/admin", json=body).status_code == 403
    ok = client.put("/api/v1/nodes/GF-T1/admin", json=body, headers={"X-Requested-With": "gateflame-fleet"})
    assert ok.status_code == 200


def test_note_author_is_the_signed_in_user_not_the_body(client):
    post_health(client)
    login(client)
    h = {"X-Requested-With": "gateflame-fleet"}
    assert client.post("/api/v1/nodes/GF-T1/notes", json={"body": "hi", "author": "mallory"}, headers=h).status_code == 201
    notes = client.get("/api/v1/nodes/GF-T1").json()["notes"]
    assert notes[0]["author"] == "admin"


# ------------------------------------------------------------ forget a node's token (C2)
#
# BUG-30's console half. A re-imaged box presents the shared token; while this
# server holds an ACTIVATED token for it, that is refused forever. Support
# forgets the token; the next shared-token check-in enrols the box again.

XRW = {"X-Requested-With": "gateflame-fleet"}


def enrol_and_activate(c, node="GF-T1"):
    tok = post_health(c, node=node).json()["nodeToken"]
    assert post_health(c, node=node, token=tok).status_code == 204  # first use activates it
    return tok


def token_rows(node="GF-T1"):
    with fleet.db() as conn:
        return conn.execute("SELECT COUNT(*) FROM tokens WHERE node_id = ?", (node,)).fetchone()[0]


def test_forget_token_needs_admin_auth(client):
    enrol_and_activate(client)
    r = client.delete("/api/v1/nodes/GF-T1/token")
    assert r.status_code == 401 and "www-authenticate" not in r.headers
    assert client.delete("/api/v1/nodes/GF-T1/token", headers=basic("wrong")).status_code == 401
    assert token_rows() == 1


def test_forget_token_on_a_cookie_session_needs_the_csrf_header(client):
    enrol_and_activate(client)
    login(client)
    assert client.delete("/api/v1/nodes/GF-T1/token").status_code == 403
    assert token_rows() == 1


def test_forget_token_removes_only_the_token_audits_it_and_the_box_re_enrols(client):
    old = enrol_and_activate(client)
    login(client)
    client.put("/api/v1/nodes/GF-T1/admin", json={"label": "Van Wyk", "tags": ["b3"], "billingState": "active"},
               headers=XRW)
    client.post("/api/v1/nodes/GF-T1/notes", json={"body": "box re-imaged by customer"}, headers=XRW)
    before = client.get("/api/v1/nodes/GF-T1").json()
    assert before["tokenActivatedAt"] is not None

    r = client.delete("/api/v1/nodes/GF-T1/token", headers=XRW)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["forgottenIssuedAt"] == before["tokenIssuedAt"]
    assert body["forgottenActivatedAt"] == before["tokenActivatedAt"]
    assert token_rows() == 0                                        # the row is gone

    d = client.get("/api/v1/nodes/GF-T1").json()                    # ...and nothing else
    assert d["tokenIssuedAt"] is None and d["tokenActivatedAt"] is None
    assert (d["label"], d["tags"], d["billingState"]) == ("Van Wyk", ["b3"], "active")
    assert len(client.get("/api/v1/nodes/GF-T1/history").json()["points"]) == 2
    audit = [n for n in d["notes"] if n["body"].startswith("Feed token forgotten by admin at ")]
    assert len(audit) == 1 and audit[0]["author"] == "admin" and audit[0]["id"] == body["noteId"]
    assert "first used by the box" in audit[0]["body"]
    assert any(n["body"] == "box re-imaged by customer" for n in d["notes"])

    again = post_health(client)                                     # the shared token enrols it again
    assert again.status_code == 201 and again.json()["nodeToken"] != old
    assert client.get("/api/v1/nodes/GF-T1").json()["tokenIssuedAt"] is not None


def test_after_forget_the_old_per_node_token_is_refused(client):
    """The forget must not leave the old token valid - it is the credential of
    a box that may no longer be the customer's (re-imaged, resold, stolen)."""
    old = enrol_and_activate(client)
    assert client.delete("/api/v1/nodes/GF-T1/token", headers=basic()).status_code == 200
    assert post_health(client, token=old).status_code == 401        # before the box re-enrols
    new = post_health(client).json()["nodeToken"]
    assert post_health(client, token=old).status_code == 401        # and after
    assert post_health(client, token=new).status_code == 204


def test_forget_with_nothing_on_file_is_404_and_writes_no_audit(client):
    assert client.delete("/api/v1/nodes/GF-NEVER/token", headers=basic()).status_code == 404
    enrol_and_activate(client)
    assert client.delete("/api/v1/nodes/GF-T1/token", headers=basic()).status_code == 200
    second = client.delete("/api/v1/nodes/GF-T1/token", headers=basic())
    assert second.status_code == 404 and "nothing was forgotten" in second.json()["detail"]
    notes = client.get("/api/v1/nodes/GF-T1", headers=basic()).json()["notes"]
    assert sum(n["body"].startswith("Feed token forgotten") for n in notes) == 1


# ------------------------------------------------------------ rate limit

def test_login_is_rate_limited_per_address(client, monkeypatch):
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 3)
    for _ in range(3):
        assert login(client, pw="nope").headers["location"] == "/login?e=bad"
    # Even the RIGHT password is refused while locked.
    r = login(client)
    assert r.headers["location"] == "/login?e=locked" and "retry-after" in r.headers
    assert client.get("/api/v1/nodes", headers=basic()).status_code == 429


def test_basic_failures_count_toward_the_same_limit(client, monkeypatch):
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 2)
    client.get("/api/v1/nodes", headers=basic("a"))
    client.get("/api/v1/nodes", headers=basic("b"))
    assert client.get("/api/v1/nodes", headers=basic()).status_code == 429


def test_success_clears_the_failure_count(client, monkeypatch):
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 3)
    login(client, pw="nope"); login(client, pw="nope")
    assert login(client).headers["location"] == "/"
    login(client, pw="nope"); login(client, pw="nope")
    assert login(client).headers["location"] == "/"


# ------------------------------------------------------------ path prefix

PFX = {"X-Forwarded-Prefix": "/gateflame"}


def test_prefix_from_trusted_proxy_rewrites_redirects_and_base(client):
    r = client.get("/", headers=PFX, follow_redirects=False)
    assert r.headers["location"] == "/gateflame/login"
    assert '<base href="/gateflame/">' in client.get("/login", headers=PFX).text


def test_prefix_login_cookie_is_scoped_to_the_prefix(client):
    r = login(client, headers=PFX)
    assert r.headers["location"] == "/gateflame/"
    assert "path=/gateflame/" in r.headers["set-cookie"].lower()


def test_prefix_works_whether_or_not_the_proxy_strips_it(client):
    assert client.get("/healthz", headers=PFX).json() == {"ok": True}
    assert client.get("/gateflame/healthz", headers=PFX).json() == {"ok": True}
    assert client.get("/gateflame/assets/app.css", headers=PFX).status_code == 200


def test_ingest_contract_unchanged_under_prefix(client):
    assert post_health(client).status_code == 201  # plain path still works
    r =client.post("/gateflame/api/v1/nodes/GF-P1/health", headers={"Authorization": "Bearer enrol-secret", **PFX},
                    content=json.dumps({"nodeId": "GF-P1", "host": {}, "modules": []}))
    assert r.status_code == 201 and "nodeToken" in r.json()


def test_prefix_from_untrusted_peer_is_ignored(client, monkeypatch):
    monkeypatch.setattr(fleet, "_TRUSTED", fleet._parse_trusted("10.99.0.1"))
    r = client.get("/", headers=PFX, follow_redirects=False)
    assert r.headers["location"] == "/login"


@pytest.mark.parametrize("bad", ["//evil.example", "https://evil.example", "/a/../b", "/x?y", "gateflame", "/ok\\x"])
def test_crafted_prefix_cannot_become_an_open_redirect(client, bad):
    r = client.get("/", headers={"X-Forwarded-Prefix": bad}, follow_redirects=False)
    assert r.headers["location"] == "/login"


def test_forwarded_for_is_the_rate_limit_key_behind_the_proxy(client, monkeypatch):
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 2)
    a, b = {"X-Forwarded-For": "192.168.0.50"}, {"X-Forwarded-For": "192.168.0.51"}
    login(client, pw="x", headers=a); login(client, pw="x", headers=a)
    assert login(client, headers=a).headers["location"] == "/login?e=locked"
    assert login(client, headers=b).headers["location"] == "/"


# ------------------------------------------------------------ TLS front door (C4)

# The docker-compose.yml shape: Caddy is NOT loopback, it is a container on the
# pinned compose subnet, and the fleet trusts exactly that subnet.
COMPOSE_SUBNET = "172.30.91.0/24"
HTTPS = {"X-Forwarded-Proto": "https"}


def test_behind_a_trusted_proxy_https_means_secure_cookie_and_hsts(client_from, monkeypatch):
    monkeypatch.setattr(fleet, "_TRUSTED", fleet._parse_trusted(COMPOSE_SUBNET))
    caddy = client_from("172.30.91.3")
    r = login(caddy, headers=HTTPS)
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert "secure" in cookie_attrs(r.headers["set-cookie"])
    assert r.headers["strict-transport-security"].startswith("max-age=")
    # Every response over https carries it, not only the login.
    assert "strict-transport-security" in caddy.get("/healthz", headers=HTTPS).headers
    # And the same proxy forwarding plain http gets neither.
    plain = login(caddy, headers={"X-Forwarded-Proto": "http"})
    assert "secure" not in cookie_attrs(plain.headers["set-cookie"])
    assert "strict-transport-security" not in plain.headers


def test_forwarded_headers_from_an_untrusted_peer_are_ignored(client_from, monkeypatch):
    """The fleet binds 0.0.0.0 for the boxes, so any LAN device can reach it.
    One claiming to be a proxy must change nothing: no https (no Secure, no
    HSTS), no prefix, and no client address it picked - or it could dodge the
    login rate limit by inventing a new X-Forwarded-For per attempt."""
    monkeypatch.setattr(fleet, "LOGIN_MAX_FAILURES", 2)
    lan = client_from("192.168.124.50")  # default trust is loopback only
    spoof = {"X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/gateflame", "X-Forwarded-For": "10.1.1.1"}
    r = login(lan, headers=spoof)
    assert r.headers["location"] == "/"                            # prefix ignored
    assert cookie_attrs(r.headers["set-cookie"])["path"] == "/"     # cookie not scoped to the claimed prefix
    assert "secure" not in cookie_attrs(r.headers["set-cookie"])    # proto ignored
    assert "strict-transport-security" not in r.headers
    login(lan, pw="x", headers={"X-Forwarded-For": "10.0.0.1"})
    login(lan, pw="x", headers={"X-Forwarded-For": "10.0.0.2"})
    locked = login(lan, headers={"X-Forwarded-For": "10.0.0.3"})
    assert locked.headers["location"] == "/login?e=locked"         # keyed on the real peer


def test_deploy_files_agree_with_the_app():
    """The packaging only works if it matches what app.py does today: Caddy's
    address inside the trusted range, the health check on a real route, uvicorn
    never rewriting the client address first, and the front door owning
    X-Forwarded-Prefix rather than passing a client's through."""
    root = fleet.STATIC_DIR.parent
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")
    subnet = re.search(r"subnet:\s*\"?([0-9a-fA-F:./]+)", compose)
    trusted = re.search(r"GATEFLAME_FLEET_TRUSTED_PROXIES:\s*\"([^\"]+)\"", compose)
    assert subnet and trusted, "compose must pin its subnet and trust it explicitly"
    assert subnet.group(1) == COMPOSE_SUBNET
    net = ipaddress.ip_network(subnet.group(1))
    assert any(n != "*" and net.version == n.version and net.subnet_of(n)
               for n in fleet._parse_trusted(trusted.group(1))), "Caddy's subnet is not trusted"
    assert "*" not in trusted.group(1)
    docker = (root / "Dockerfile").read_text(encoding="utf-8")
    assert "127.0.0.1:8091/healthz" in docker and "--no-proxy-headers" in docker
    assert any(getattr(r, "path", None) == "/healthz" for r in fleet.app.routes)
    unit = (root / "deploy" / "gateflame-fleet.service").read_text(encoding="utf-8")
    assert "--host 127.0.0.1" in unit and "--no-proxy-headers" in unit
    assert "fleet-backup" in unit, "the unit's comment block must point at the backup"
    for name in ("Caddyfile", "Caddyfile.example"):
        caddy = (root / "deploy" / name).read_text(encoding="utf-8")
        assert re.search(r"^\s*header_up -X-Forwarded-Prefix\s*$", caddy, re.M), name


# ------------------------------------------------------------ headers

def test_security_headers_and_strict_csp(client):
    r = client.get("/login")
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp and "frame-ancestors 'none'" in csp
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"


def test_pages_have_no_inline_script_or_style_or_third_party_origin():
    """The CSP forbids them; a page that used them would render broken."""
    import re
    for name in ("index.html", "login.html"):
        html = (fleet.STATIC_DIR / name).read_text(encoding="utf-8")
        assert not re.search(r"<script(?![^>]*\bsrc=)", html), name
        assert "<style" not in html and " style=" not in html and " onclick=" not in html, name
        assert "http://" not in html and "https://" not in html, name
    js = (fleet.STATIC_DIR / "assets" / "app.js").read_text(encoding="utf-8")
    assert "style=\"" not in js and " onclick=" not in js
    assert "fetch('/" not in js and "api('/" not in js, "absolute API path breaks the /gateflame prefix"


def test_fonts_are_real_woff2_not_text_mangled():
    for f in (fleet.STATIC_DIR / "assets" / "fonts").glob("*.woff2"):
        head = f.read_bytes()[:4]
        assert head == b"wOF2", f.name
        assert b"\xef\xbf\xbd" not in f.read_bytes()[:64], f.name


# ------------------------------------------------------------ ingest validation

def test_ingest_rejects_non_object_json_with_400_not_500(client):
    assert post_health(client, body="[1,2,3]").status_code == 400
    assert post_health(client, body='"x"').status_code == 400


def test_ingest_rejects_oversized_body(client):
    big = json.dumps({"nodeId": "GF-T1", "pad": "x" * (fleet.MAX_INGEST_BYTES + 10)})
    assert post_health(client, body=big).status_code == 413


def test_ingest_tolerates_wrong_typed_fields(client):
    body = {"nodeId": "GF-T1", "host": "not-a-dict", "modules": "nope", "uptimeSeconds": "long"}
    assert post_health(client, body=body).status_code == 201
    d = client.get("/api/v1/nodes/GF-T1", headers=basic()).json()
    assert d["host"] == {} and d["modules"] == []


def test_list_reflects_a_new_checkin_despite_payload_cache(client):
    tok = post_health(client).json()["nodeToken"]
    assert client.get("/api/v1/nodes", headers=basic()).json()[0]["host"]["cpuPercent"] == 5.0
    import time as _t
    _t.sleep(0.01)
    assert post_health(client, token=tok, body={"nodeId": "GF-T1", "host": {"cpuPercent": 77.0}}).status_code == 204
    assert client.get("/api/v1/nodes", headers=basic()).json()[0]["host"]["cpuPercent"] == 77.0


def _race(monkeypatch, sql):
    """Run `sql` in the gap between _authorise_node's read and its write - the
    moment it mints the token - to stand in for a concurrent request."""
    real = fleet.secrets.token_urlsafe

    def minted(n=32):
        with fleet.db() as conn:
            conn.execute(sql)
        monkeypatch.setattr(fleet.secrets, "token_urlsafe", real)  # once
        return real(n)

    monkeypatch.setattr(fleet.secrets, "token_urlsafe", minted)


def test_a_reissue_that_loses_a_race_is_not_answered_201(client, monkeypatch):
    """A 201 hands the box a token it will present from then on. If its row was
    forgotten between the read and the write, this server does not hold that
    token - answering 201 would be a verdict it cannot back."""
    assert post_health(client, node="GF-R1").status_code == 201   # issued, never used
    _race(monkeypatch, "DELETE FROM tokens WHERE node_id = 'GF-R1'")
    r = post_health(client, node="GF-R1")                          # shared token -> re-issue path
    assert r.status_code == 409 and "nodeToken" not in r.text
    assert post_health(client, node="GF-R1").status_code == 201   # the next check-in sorts it out


def test_a_first_enrolment_that_loses_a_race_is_not_answered_201(client, monkeypatch):
    _race(monkeypatch, "INSERT INTO tokens (node_id, token_hash, issued_at) VALUES ('GF-R2', 'other', 1)")
    r = post_health(client, node="GF-R2")
    assert r.status_code == 409 and "nodeToken" not in r.text
    with fleet.db() as conn:
        assert conn.execute("SELECT token_hash FROM tokens WHERE node_id='GF-R2'").fetchone()[0] == "other"


def test_history_route_requires_auth_and_answers(client):
    post_health(client)
    assert client.get("/api/v1/nodes/GF-T1/history?window=7d").status_code == 401
    r = client.get("/api/v1/nodes/GF-T1/history?window=24h", headers=basic()).json()
    assert r["window"] == "24h" and len(r["points"]) == 1
    assert client.get("/api/v1/nodes/GF-T1/history?window=bogus", headers=basic()).json()["window"] == "24h"

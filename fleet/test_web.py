"""Web surface of the fleet dashboard: login/session, path prefix, headers,
ingest validation. Each test names the failure it pins.

Run: python -m pytest -q   (from fleet/)
"""
import base64
import json

import pytest
from fastapi.testclient import TestClient

import app as fleet


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(fleet, "DB_PATH", str(tmp_path / "fleet.db"))
    monkeypatch.setattr(fleet, "ADMIN_USER", "admin")
    monkeypatch.setattr(fleet, "ADMIN_PASSWORD", "test-pw")
    monkeypatch.setattr(fleet, "ENROL_TOKEN", "enrol-secret")
    fleet.login_limiter.reset()
    fleet._payload_cache.clear()
    with TestClient(fleet.app, base_url="http://testserver", client=("127.0.0.1", 50000)) as c:  # runs the lifespan
        yield c
    fleet.login_limiter.reset()


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
    assert "secure" not in sc  # plain http: a Secure cookie would never come back
    page = client.get("/")
    assert page.status_code == 200 and "assets/app.js" in page.text


def test_cookie_is_secure_when_proxy_says_https(client):
    r = login(client, headers={"X-Forwarded-Proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()
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


def test_history_route_requires_auth_and_answers(client):
    post_health(client)
    assert client.get("/api/v1/nodes/GF-T1/history?window=7d").status_code == 401
    r = client.get("/api/v1/nodes/GF-T1/history?window=24h", headers=basic()).json()
    assert r["window"] == "24h" and len(r["points"]) == 1
    assert client.get("/api/v1/nodes/GF-T1/history?window=bogus", headers=basic()).json()["window"] == "24h"

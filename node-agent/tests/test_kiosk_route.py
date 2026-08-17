"""
Kiosk static-route tests.

WHY THESE EXIST

The kiosk bundle was built by `npm run build:html-kiosk` every release and
served by absolutely nothing: node-agent had no static route, so /device-kiosk
404'd and the built HTML was dead weight on the Pi.

The first attempt at a fix was worse than no fix: it served index.html with a
200 while every /assets/* script 404'd, because the bundle is built with
base "/" and requests its scripts absolutely from the server root. That is a
blank screen that looks like a frontend bug.

So these tests assert BOTH halves - the page is served, AND every asset it
references resolves. "HTML served" and "kiosk works" are not the same thing.

They deliberately do NOT reload gateflame.main. Reloading re-runs
`store = Store(...)` and rebuilds every ScopeChecker, which leaks into any test
module imported afterwards; it broke three pairing tests once already.
"""

import re

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from gateflame.main import app as real_app
from gateflame.main import mount_device_kiosk
from gateflame.security import require_lan


def client(target):
    """TestClient with a real loopback source address.

    require_lan() refuses anything that is not RFC1918/loopback/link-local, and
    TestClient's default client host is the literal string "testclient", which
    is not an IP and is correctly rejected with 403. Loopback is also what
    grants `kiosk` scope, mirroring how the real kiosk is authorised.
    """
    return TestClient(target, client=("127.0.0.1", 51000))


def build(kiosk_dir):
    """A throwaway app with only the kiosk mount and the status route."""
    a = FastAPI()

    @a.get("/api/v1/system/kiosk")
    def status(request: Request):
        require_lan(request)
        return request.app.state.kiosk

    mount_device_kiosk(a, str(kiosk_dir))
    return a


@pytest.fixture
def kiosk_bundle(tmp_path):
    """A minimal bundle shaped exactly like a real dist-kiosk output."""
    d = tmp_path / "dist-kiosk"
    (d / "assets").mkdir(parents=True)
    (d / "assets" / "kiosk.abc123.js").write_text("console.log('kiosk')")
    (d / "assets" / "style.def456.css").write_text("body{}")
    (d / "index.html").write_text(
        "<!DOCTYPE html><html><head>"
        '<script type="module" src="/assets/kiosk.abc123.js"></script>'
        '<link rel="stylesheet" href="/assets/style.def456.css">'
        "</head><body></body></html>"
    )
    return d


def test_kiosk_page_is_served_when_a_bundle_is_present(kiosk_bundle):
    c = client(build(kiosk_bundle))
    r = c.get("/device-kiosk/")
    assert r.status_code == 200
    assert "kiosk.abc123.js" in r.text


def test_every_referenced_asset_resolves(kiosk_bundle):
    """The regression test for the blank-screen failure.

    Parses the served HTML for /assets/* references and asserts each is a 200 -
    the same check install-kiosk.sh runs on the Pi.
    """
    c = client(build(kiosk_bundle))
    html = c.get("/device-kiosk/").text
    refs = sorted(set(re.findall(r"/assets/[A-Za-z0-9._-]+", html)))

    assert refs, "no asset references found - the fixture is wrong"
    for ref in refs:
        assert c.get(ref).status_code == 200, f"{ref} did not resolve"


def test_status_reports_mounted_with_no_gap(kiosk_bundle):
    body = client(build(kiosk_bundle)).get("/api/v1/system/kiosk").json()
    assert body["mounted"] is True
    assert body["path"] == "/device-kiosk"
    assert body["gap"] is None


def test_absent_bundle_is_an_honest_named_gap(tmp_path):
    """No bundle => not mounted at all, and the gap says why.

    Mounted-and-empty would make a 404 ambiguous between "not installed" and
    "installed but broken" - the ambiguity that let this sit unnoticed.
    """
    empty = tmp_path / "nothing-here"
    empty.mkdir()
    c = client(build(empty))

    body = c.get("/api/v1/system/kiosk").json()
    assert body["mounted"] is False
    assert body["path"] is None
    assert "no index.html" in body["gap"]
    assert c.get("/device-kiosk/").status_code == 404


def test_bundle_without_an_assets_dir_still_mounts_the_page(tmp_path):
    d = tmp_path / "html-only"
    d.mkdir()
    (d / "index.html").write_text("<html><body>hi</body></html>")
    c = client(build(d))
    assert c.get("/device-kiosk/").status_code == 200
    assert c.get("/api/v1/system/kiosk").json()["mounted"] is True


def test_the_real_app_exposes_kiosk_state():
    """The shipped app must always have state.kiosk set, mounted or not."""
    assert hasattr(real_app.state, "kiosk")
    assert set(real_app.state.kiosk) == {"mounted", "path", "directory", "gap"}


def test_api_routes_are_unaffected_by_the_static_mount():
    """Mounting /assets at the root must not shadow /api/v1/*."""
    c = client(real_app)
    assert c.get("/api/v1/system/status").status_code == 200

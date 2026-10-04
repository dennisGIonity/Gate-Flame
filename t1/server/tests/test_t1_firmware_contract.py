"""Static contract between the T1 sketch and the T1 server.

The sketch cannot run in CI (no ESP32), and it was compiled once by hand with arduino-cli. These tests
pin the properties that must never silently regress, by reading the source: a refactor that drops one of
them fails here instead of on a customer's shelf. Each assertion is paired with the server route or
rule it depends on, so a rename on either side is caught too.
"""
from __future__ import annotations

import re
from pathlib import Path

FW = Path(__file__).resolve().parents[2] / "firmware" / "GF_T1_Node"
INO = (FW / "GF_T1_Node.ino").read_text(encoding="utf-8")
CFG = (FW / "config.h").read_text(encoding="utf-8")
APP = (Path(__file__).resolve().parents[1] / "t1server" / "app.py").read_text(encoding="utf-8")


def test_no_secret_is_compiled_in():
    # settings come from NVS; secrets.h is optional lab convenience and must stay guarded + git-ignored
    assert '#if __has_include("secrets.h")' in INO
    assert "WIFI_SSID" not in CFG and "T1_DEVICE_TOKEN" not in CFG
    assert "firmware/GF_T1_Node/secrets.h" in (FW.parents[1] / ".gitignore").read_text()


def test_every_device_route_the_sketch_calls_exists_on_the_server():
    for route in re.findall(r'"(/api/t1/v1/[a-z/._-]+)', INO):
        base = route.split("?")[0].rstrip("/")
        assert base in APP or base.rsplit("/", 1)[0] in APP, f"sketch calls {route}, server has no such route"


def test_enrolment_uses_its_own_header_and_erases_the_enrolment_token():
    assert '"X-T1-Enrol"' in INO and "x-t1-enrol" in APP
    assert 'prefs.remove("enrol")' in INO
    assert "409" in INO and "401" in INO and "429" in INO    # the three refusals each get their own sentence


def test_device_requests_carry_id_and_token():
    assert '"X-T1-Id"' in INO and '"X-T1-Token"' in INO
    assert "x-t1-id" in APP and "x-t1-token" in APP


def test_ota_verifies_hash_and_signature_before_finalising_the_slot():
    body = INO[INO.index("static bool otaApply"):INO.index("static bool imagePending")]
    end = body.index("Update.end(")
    assert body.index("tohex(dg, 32) != sha") < end, "SHA-256 must be checked before Update.end"
    assert body.index("verifySig(dg, sig)") < end, "the signature must be checked before Update.end"
    assert "Update.abort()" in body
    assert "enrolled()" in body                               # an un-enrolled board takes no firmware
    assert "OTA_MIN_HEAP" in body


def test_ota_rolls_back_unless_the_new_image_proves_itself():
    assert 'extern "C" bool verifyRollbackLater()' in INO
    assert "esp_ota_mark_app_valid_cancel_rollback" in INO
    assert "esp_ota_mark_app_invalid_rollback_and_reboot" in INO
    v = INO[INO.index("static void validateImage"):INO.index("static bool checkForUpdate")]
    for proof in ("serverAnswered", "filterOk", "dnsAlive", "WL_CONNECTED"):
        assert proof in v, f"validateImage no longer requires {proof}"
    assert "OTA_VALIDATE_MS" in v


def test_ota_manifest_request_names_the_running_version():
    assert "&fw=\" FW_VERSION" in INO                         # the server stages rollouts per running version


def test_filter_and_allowlist_signatures_are_still_checked_on_every_load():
    assert INO.count("verifySig(") >= 5
    load = INO[INO.index("static bool loadFilterFromFlash"):INO.index("static int cmpU64")]
    assert 'verifySig(dg, readSmall("/filter.sig"))' in load
    assert "signature INVALID" in INO


def test_cache_never_serves_before_the_filter_has_spoken():
    h = INO[INO.index("static void handleClient"):INO.index("static void handleUpstream")]
    assert h.index("verdict == 1") < h.index("gf_cache_get"), "the filter verdict must come before the cache read"


def test_only_forwarded_answers_are_cached():
    u = INO[INO.index("static void handleUpstream"):INO.index("static void sweep")]
    assert "gf_cache_put" in u and "p.used" in u


def test_dns_over_tcp_is_served_and_framed():
    assert "WiFiServer dnsTcp(DNS_PORT)" in INO
    assert "gf_tcp_frame" in INO and "gf_tcp_rx_feed" in INO
    assert "TCP_MAX_QUERIES" in INO and "TCP_SESSION_MS" in INO     # one client cannot hold the worker forever


def test_privacy_no_domain_name_in_telemetry():
    t = INO[INO.index("static bool sendTelemetry"):INO.index("// Core 0: everything that may block")]
    assert "q.name" not in t and "qname" not in t.lower()


def test_serial_never_echoes_a_secret():
    s = INO[INO.index("static String provSet"):INO.index("static void provLine")]
    assert "changed +=" in s and 'changed += String(first ? "" : ",") + "\\"" + o.kv[i].key' in s
    # every line that appends to the reply names the key only - none of them touches a value
    for line in s.splitlines():
        if "changed +=" in line or line.strip().startswith("return"):
            assert ".val" not in line, line
    hello = INO[INO.index("static String provHello"):INO.index("static String provScan")]
    assert "has_pass" in hello and "jq(cfgPass)" not in hello and "jq(cfgToken)" not in hello and "jq(cfgEnrol)" not in hello


def test_settings_are_validated_before_any_is_applied():
    s = INO[INO.index("static String provSet"):INO.index("static void provLine")]
    assert s.index("settingOk(") < s.index("applySetting(")


def test_hotspot_password_is_derived_not_fixed():
    assert 'gft1-ap:' in INO and "tohex(digest, 4)" in INO


def test_status_vocabulary_is_the_t3_five():
    s = INO[INO.index("static const char *statusStr"):INO.index("// ── settings (NVS)")]
    for v in ("applying", "paused", "bypass", "degraded", "active"):
        assert f'"{v}"' in s


def test_factory_reset_exists_on_serial_and_button():
    assert '"factory_reset"' in INO and "RESET_HOLD_MS" in INO and "digitalRead(0)" in INO
    # holding BOOT through a reset enters the ROM download mode, so the reset gesture is "held while running"
    assert "BOOT held" in INO

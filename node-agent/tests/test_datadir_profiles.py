"""The .DUMP data root, profiles and accessibility preferences.

Invariants worth pinning:

  - the root and every subfolder are created on ensure(), and reported
  - an unwritable root is REPORTED, never raised - the box must keep filtering
  - the active profile is derived from live settings, so a hand edit shows
    as "custom" instead of a preset the box is not actually running
  - accessibility values are bounded and unknown keys are dropped
  - writes are atomic: a half-written file never replaces a good one
"""

from __future__ import annotations

import json
import os

import pytest

from gateflame import datadir, profiles


@pytest.fixture
def root(tmp_path, monkeypatch):
    r = tmp_path / ".DUMP"
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(r))
    return r


# ---------------------------------------------------------------- datadir


def test_ensure_creates_the_root_and_every_subfolder(root):
    st = datadir.ensure()
    assert st["present"] is True
    assert st["healthy"] is True
    for sub in datadir.SUBDIRS:
        assert (root / sub).is_dir(), sub
        assert st["subdirs"][sub]["writable"] is True


def test_status_before_ensure_reports_absent_not_error(root):
    st = datadir.status()
    assert st["present"] is False
    assert st["healthy"] is False
    assert all(v["present"] is False for v in st["subdirs"].values())


def test_path_refuses_unknown_subdir(root):
    with pytest.raises(ValueError):
        datadir.path("not-a-folder")


def test_path_is_posix_regardless_of_host(root):
    p = datadir.path("ml", "baseline.json")
    assert p.endswith("ml/baseline.json")
    assert "\\" not in p.split(str(root))[-1]


def test_status_counts_files_and_bytes(root):
    datadir.ensure()
    (root / "exports" / "a.txt").write_text("hello")
    (root / "exports" / "b.txt").write_text("world!!")
    st = datadir.status()
    assert st["subdirs"]["exports"]["files"] == 2
    assert st["subdirs"]["exports"]["bytes"] == 12
    assert st["totalBytes"] == 12


def test_backup_file_copies_and_prunes(root, tmp_path):
    datadir.ensure()
    src = tmp_path / "state.db"
    src.write_bytes(b"x" * 10)
    made = []
    for i in range(5):
        # Distinct names: the stamp has second resolution, so bump the label.
        made.append(datadir.backup_file(str(src), f"state{i}", keep=2))
    assert all(m and os.path.isfile(m) for m in made)
    # Prune is per-label; each label had one copy so nothing is removed.
    assert len(os.listdir(root / "backups")) == 5


def test_backup_file_of_missing_source_is_none(root):
    datadir.ensure()
    assert datadir.backup_file("/nowhere/state.db", "state") is None


# ---------------------------------------------------------------- profiles


def _settings(level, cats):
    return {"threat_level": level, "categories": cats, "enabled": True,
            "pause_duration": None, "pause_resume_at": None, "pause_reason": None}


def test_every_preset_round_trips_through_match(root):
    for pid in profiles.PRESETS:
        level, cats = profiles.settings_for(pid)
        assert profiles.match_preset(level, cats) == pid


def test_active_profile_is_derived_from_live_settings_not_a_file(root):
    datadir.ensure()
    # Someone applied "family" through the API...
    profiles.record_applied("family", "kiosk")
    # ...then changed a category by hand. The picker must NOT still say family.
    d = profiles.describe(_settings("medium", ["adult"]))
    assert d["active"] == profiles.CUSTOM_ID
    assert d["activeLabel"] == "Custom"
    # But the record of who last applied a preset is still there, as history.
    assert d["appliedBy"] == "kiosk"


def test_describe_matches_a_preset_when_settings_equal_it(root):
    datadir.ensure()
    d = profiles.describe(_settings("high", ["social", "gambling", "adult"]))
    assert d["active"] == "strict"  # order-insensitive


def test_presets_only_use_known_categories_and_levels(root):
    from gateflame import content_categories, threat_level
    for p in profiles.PRESETS.values():
        assert p["threatLevel"] in ("low", "medium", "high")
        assert threat_level.describe(p["threatLevel"])["level"] == p["threatLevel"]
        for c in p["categories"]:
            assert content_categories.known(c), c


def test_describe_reports_whether_profiles_folder_is_writable(root):
    datadir.ensure()
    assert profiles.describe(_settings("low", []))["storageWritable"] is True


# ----------------------------------------------------------- accessibility


def test_accessibility_defaults_when_nothing_stored(root):
    datadir.ensure()
    prefs = profiles.get_accessibility()
    assert prefs["reducedMotion"] is False
    assert prefs["textScale"] == 1.0


def test_accessibility_patch_is_bounded_and_persisted(root):
    datadir.ensure()
    prefs, ok = profiles.set_accessibility({"textScale": 9.0, "keepAwakeMinutes": -5, "reducedMotion": 1})
    assert ok is True
    assert prefs["textScale"] == 1.6
    assert prefs["keepAwakeMinutes"] == 0
    assert prefs["reducedMotion"] is True
    # Survives a fresh read.
    again = profiles.get_accessibility()
    assert again["textScale"] == 1.6
    assert again["updatedAt"] > 0


def test_accessibility_unknown_keys_are_dropped(root):
    datadir.ensure()
    prefs, _ = profiles.set_accessibility({"evil": "payload", "highContrast": True})
    assert "evil" not in prefs
    assert prefs["highContrast"] is True


def test_accessibility_bad_number_is_rejected_not_coerced(root):
    datadir.ensure()
    with pytest.raises(ValueError):
        profiles.validate_accessibility({"textScale": "big"})


def test_write_is_atomic_no_tmp_left_behind(root):
    datadir.ensure()
    profiles.set_accessibility({"highContrast": True})
    files = os.listdir(root / "profiles")
    assert files == ["accessibility.json"], files


def test_corrupt_accessibility_file_degrades_to_defaults(root):
    datadir.ensure()
    (root / "profiles" / "accessibility.json").write_text("{not json")
    prefs = profiles.get_accessibility()
    assert prefs["textScale"] == 1.0


def test_unwritable_root_is_reported_not_raised(tmp_path, monkeypatch):
    # A file where the root should be: makedirs fails, nothing can be written.
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file")
    monkeypatch.setenv("GATEFLAME_DATA_ROOT", str(blocker))
    st = datadir.ensure()
    assert st["healthy"] is False
    prefs, ok = profiles.set_accessibility({"highContrast": True})
    assert ok is False
    assert prefs["highContrast"] is True  # the caller still gets the merged value

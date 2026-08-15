"""Tests for module_wan_audit.

The centre of gravity is `classify_delta`. Interface byte counters reset on
reboot and on interface down/up, and 32-bit counters wrap every 4.29 GB; a
naive subtraction therefore produces either a negative delta or a phantom
multi-gigabyte spike that silently consumes a customer's monthly budget. The
first section below is an exhaustive attack on that function — it is the piece
of this module whose failure a customer would only notice as a wrong bill.

Everything runs without root, without a network, without a Pi: the counter
reader, the latency probe, the clock and the calendar are all injected.
"""

from __future__ import annotations

import time

import pytest

from gateflame import wan
from gateflame.wan import (
    COUNTER_32BIT_MODULUS,
    KIND_AMBIGUOUS,
    KIND_CLOCK,
    KIND_FIRST_SAMPLE,
    KIND_IMPLAUSIBLE,
    KIND_LINK_BOUNCE,
    KIND_NORMAL,
    KIND_REBOOT,
    KIND_RESET_UNEXPLAINED,
    KIND_WRAP32,
    CounterSample,
    UtcMonthCalendar,
    WanAudit,
    WanConfig,
    WanStore,
    classify_delta,
    project_month_end,
    restart_signals,
    summarise_latency,
    wan_config_from_env,
)

MINUTE = 60.0
GB = 1024**3


# ── 1. Counter deltas: reset, wrap, and the phantom spike ──────────────────


def test_first_sample_attributes_nothing():
    """A baseline is not usage. Attributing `current` on the first ever sample
    would bill the customer for every byte since the Pi was switched on."""
    d = classify_delta(None, 5 * GB, MINUTE)
    assert d.attributed == 0
    assert d.kind == KIND_FIRST_SAMPLE


def test_normal_forward_movement():
    d = classify_delta(1_000, 4_000, MINUTE)
    assert (d.attributed, d.kind) == (3_000, KIND_NORMAL)


def test_reboot_attributes_bytes_since_boot_not_the_difference():
    """After a reboot the counter restarted at zero, so the honest delta is
    the whole current value — `current - previous` would be negative."""
    d = classify_delta(9 * GB, 500_000, 3 * MINUTE, rebooted=True)
    assert (d.attributed, d.kind) == (500_000, KIND_REBOOT)
    assert "restarted at zero" in d.note


def test_reboot_is_detected_even_when_the_counter_moved_forward():
    """A reboot while the old counter was still small leaves current > previous.
    Taking the plain difference there would UNDER-count by the whole of the
    previous boot's traffic — which is why the reboot branch runs first."""
    d = classify_delta(100, 900, MINUTE, rebooted=True)
    assert (d.attributed, d.kind) == (900, KIND_REBOOT)


def test_link_bounce_with_backward_counter_is_a_reset_not_a_wrap():
    d = classify_delta(3 * GB, 1_000, MINUTE, rebooted=False, link_bounced=True)
    assert (d.attributed, d.kind) == (1_000, KIND_LINK_BOUNCE)


def test_link_bounce_with_forward_counter_is_still_an_ordinary_delta():
    """A carrier flap does not necessarily reset the counters. If the counter
    still moved forward, attributing `current` would double-count every byte
    since boot — a phantom spike from the *other* direction."""
    d = classify_delta(1_000_000_000, 1_000_000_500, MINUTE, rebooted=False, link_bounced=True)
    assert d.attributed == 500
    assert d.kind == KIND_NORMAL
    assert "link bounced" in d.note


def test_32bit_wrap_is_measured_when_no_restart_occurred():
    previous = COUNTER_32BIT_MODULUS - 1_000_000
    d = classify_delta(previous, 2_000_000, MINUTE, rebooted=False, link_bounced=False)
    assert d.kind == KIND_WRAP32
    assert d.attributed == 3_000_000  # 1 MB to the top, 2 MB after it


def test_a_wrap_is_only_claimed_when_the_link_could_have_carried_it():
    """previous is low, so a wrap would mean 4.29 GB moved in five seconds —
    six times the NIC's physical ceiling. That is a reset, not a wrap, even
    though the host reported no reboot and no link bounce."""
    d = classify_delta(50_000, 1_000, 5.0, rebooted=False, link_bounced=False)
    assert d.kind == KIND_RESET_UNEXPLAINED
    assert d.attributed == 1_000


def test_64bit_counters_are_never_treated_as_wrapped():
    """A value above 2**32 cannot be a 32-bit counter, and a 64-bit counter
    would take millennia to wrap. Backwards movement there is always a reset."""
    previous = COUNTER_32BIT_MODULUS + 10 * GB
    d = classify_delta(previous, 4_000, MINUTE, rebooted=False, link_bounced=False)
    assert d.kind == KIND_RESET_UNEXPLAINED
    assert d.attributed == 4_000


def test_unknown_restart_signals_take_the_conservative_reading_and_say_so():
    """A host that exposes neither a boot id nor a carrier-change count leaves
    reset and wrap genuinely indistinguishable. The smaller candidate is
    attributed and the ambiguity is named rather than inherited silently."""
    previous = COUNTER_32BIT_MODULUS - 300_000_000
    d = classify_delta(previous, 1_000, MINUTE)
    assert d.kind == KIND_AMBIGUOUS
    assert d.attributed == 1_000
    assert "300_001_000".replace("_", "") in d.note.replace(",", "") or "wrap" in d.note


def test_a_reset_can_never_produce_a_phantom_spike():
    """THE test this module exists for. Sweep every previous value near the
    32-bit ceiling, with a tiny current value (the shape a reboot or ifdown
    produces), and assert that nothing ever attributes the distance back to
    2**32 unless a wrap was positively established."""
    current = 1_000
    for previous in (
        COUNTER_32BIT_MODULUS - 1,
        COUNTER_32BIT_MODULUS - 10_000_000,
        COUNTER_32BIT_MODULUS - 3 * GB,
        4 * GB,
    ):
        for rebooted, bounced in ((True, False), (True, None), (False, True), (None, None)):
            d = classify_delta(
                previous, current, MINUTE, rebooted=rebooted, link_bounced=bounced
            )
            assert d.attributed <= current, (previous, rebooted, bounced, d)
            assert d.kind != KIND_WRAP32


@pytest.mark.parametrize(
    "previous,current,elapsed,rebooted,bounced",
    [
        (0, 0, MINUTE, None, None),
        (10**12, 1, MINUTE, None, None),
        (1, 10**12, MINUTE, None, None),
        (COUNTER_32BIT_MODULUS - 1, 0, 1.0, False, False),
        (5, 5, MINUTE, True, True),
        (0, 10**18, 86_400.0, None, None),
        (10**18, 0, 86_400.0, False, False),
    ],
)
def test_no_input_ever_produces_a_negative_delta(previous, current, elapsed, rebooted, bounced):
    d = classify_delta(previous, current, elapsed, rebooted=rebooted, link_bounced=bounced)
    assert d.attributed >= 0


def test_impossible_forward_jump_is_refused_rather_than_billed():
    """8 GB in one second is above the NIC's line rate, so the counter is
    lying (or the clock is). Attributing nothing and naming it beats adding a
    number to the customer's budget that no cable could have carried."""
    d = classify_delta(0, 8 * GB, 1.0)
    assert d.attributed == 0
    assert d.kind == KIND_IMPLAUSIBLE
    assert "ceiling" in d.note


@pytest.mark.parametrize("elapsed", [0.0, -1.0, -86_400.0])
def test_a_clock_that_did_not_advance_attributes_nothing(elapsed):
    """An RTC-less Pi getting the time from NTP for the first time steps the
    clock backwards. Every rate computed across that step is meaningless."""
    d = classify_delta(0, 5_000_000, elapsed)
    assert d.attributed == 0
    assert d.kind == KIND_CLOCK


def test_negative_counter_values_are_refused():
    assert classify_delta(-5, 10, MINUTE).kind == KIND_IMPLAUSIBLE
    assert classify_delta(10, -5, MINUTE).kind == KIND_IMPLAUSIBLE


def test_delta_kinds_other_than_normal_are_flagged_as_anomalies():
    assert classify_delta(1, 2, MINUTE).is_anomaly is False
    assert classify_delta(None, 2, MINUTE).is_anomaly is False
    assert classify_delta(9 * GB, 1, MINUTE, rebooted=True).is_anomaly is True


# ── 2. Restart signals are tri-state ───────────────────────────────────────


def sample(**kw):
    base = dict(iface="eth0", rx_bytes=0, tx_bytes=0, at=0.0)
    base.update(kw)
    return CounterSample(**base)


def test_boot_id_change_means_rebooted():
    a = sample(boot_id="aaa", carrier_changes=2)
    b = sample(boot_id="bbb", carrier_changes=0)
    assert restart_signals(a, b)[0] is True


def test_same_boot_id_and_carrier_means_no_restart():
    a = sample(boot_id="aaa", carrier_changes=2)
    b = sample(boot_id="aaa", carrier_changes=2)
    assert restart_signals(a, b) == (False, False)


def test_carrier_change_increase_means_the_link_bounced():
    a = sample(boot_id="aaa", carrier_changes=2)
    b = sample(boot_id="aaa", carrier_changes=4)
    assert restart_signals(a, b) == (False, True)


def test_carrier_counter_going_backwards_is_itself_a_restart():
    a = sample(boot_id=None, carrier_changes=9)
    b = sample(boot_id=None, carrier_changes=1)
    assert restart_signals(a, b) == (None, True)


def test_missing_signals_stay_unknown_rather_than_defaulting_to_false():
    """Treating 'unknown' as 'did not restart' is the bug that lets a reset be
    mistaken for a wrap. It must survive as None all the way through."""
    a = sample(boot_id=None, carrier_changes=None)
    b = sample(boot_id=None, carrier_changes=None)
    assert restart_signals(a, b) == (None, None)


# ── 3. Fakes for the seams ─────────────────────────────────────────────────


class FakeReader:
    """Serves queued readings. Records nothing to disk, touches no network."""

    def __init__(self, queued: dict[str, list[CounterSample]] | None = None, present=("eth0",)):
        self.queued = queued or {}
        self.present = list(present)

    def interfaces(self):
        return list(self.present)

    def read(self, iface, now=None):
        pending = self.queued.get(iface)
        if not pending:
            return None
        return pending.pop(0)


class FakeProbe:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def probe(self, host, port, timeout):
        self.calls.append((host, port, timeout))
        return self.results.pop(0) if self.results else None


def make_audit(tmp_path, samples, cap=None, clock_value=None, **cfg):
    holder = {"t": clock_value if clock_value is not None else 1_756_000_000.0}
    config = WanConfig(
        interfaces=("eth0",),
        monthly_cap_bytes=cap,
        probe_samples=cfg.pop("probe_samples", 3),
        db_path=str(tmp_path / "state.db"),
        **cfg,
    )
    audit = WanAudit(
        config=config,
        reader=FakeReader({"eth0": list(samples)}),
        store=WanStore(str(tmp_path / "state.db")),
        probe=FakeProbe([1.0, 2.0, 3.0]),
        calendar=UtcMonthCalendar(),
        clock=lambda: holder["t"],
    )
    return audit, holder


# ── 4. Capability is reported honestly ─────────────────────────────────────


def test_no_configured_interface_is_degraded_with_the_variable_to_set(tmp_path):
    audit = WanAudit(
        config=WanConfig(interfaces=(), db_path=str(tmp_path / "s.db")),
        reader=FakeReader(),
        store=WanStore(str(tmp_path / "s.db")),
        calendar=UtcMonthCalendar(),
    )
    usable, gap = audit.capability()
    assert usable is False
    assert "GATEFLAME_WAN_INTERFACES" in gap
    assert "guess" in gap


def test_a_configured_interface_that_does_not_exist_is_named(tmp_path):
    audit = WanAudit(
        config=WanConfig(interfaces=("ppp0",), db_path=str(tmp_path / "s.db")),
        reader=FakeReader(present=("eth0", "lo")),
        store=WanStore(str(tmp_path / "s.db")),
        calendar=UtcMonthCalendar(),
    )
    usable, gap = audit.capability()
    assert usable is False
    assert "ppp0" in gap and "eth0" in gap


def test_capability_never_raises(tmp_path):
    class Exploding(FakeReader):
        def interfaces(self):
            raise OSError("boom")

    audit = WanAudit(
        config=WanConfig(interfaces=("eth0",), db_path=str(tmp_path / "s.db")),
        reader=Exploding(),
        store=WanStore(str(tmp_path / "s.db")),
        calendar=UtcMonthCalendar(),
    )
    usable, gap = audit.capability()
    assert usable is False
    assert "boom" in gap


def test_sample_reports_the_gap_instead_of_inventing_usage(tmp_path):
    audit = WanAudit(
        config=WanConfig(interfaces=(), db_path=str(tmp_path / "s.db")),
        reader=FakeReader(),
        store=WanStore(str(tmp_path / "s.db")),
        calendar=UtcMonthCalendar(),
    )
    out = audit.sample()
    assert out["interfaces"] == {}
    assert "GATEFLAME_WAN_INTERFACES" in out["gap"]


# ── 5. Accounting and persistence ──────────────────────────────────────────

T0 = 1_756_684_800.0  # 2025-09-01T00:00:00Z — a month start, in UTC


def s(at, rx, tx, boot="boot-a", carrier=0):
    return CounterSample(
        iface="eth0", rx_bytes=rx, tx_bytes=tx, at=at, boot_id=boot, carrier_changes=carrier
    )


def test_usage_accumulates_across_samples(tmp_path):
    audit, holder = make_audit(
        tmp_path,
        [s(T0, 0, 0), s(T0 + 3600, 1_000, 500), s(T0 + 7200, 4_000, 1_500)],
        clock_value=T0 + 7200,
    )
    for _ in range(3):
        audit.sample()
    budget = audit.budget("eth0")
    assert budget["rxBytes"] == 4_000
    assert budget["txBytes"] == 1_500
    assert budget["usedBytes"] == 5_500
    audit.close()


def test_the_monthly_total_survives_an_agent_restart(tmp_path):
    """The whole point of persisting: a reboot in the middle of the month must
    not reset the customer's budget to zero."""
    db = str(tmp_path / "state.db")
    config = WanConfig(interfaces=("eth0",), db_path=db)
    first = WanAudit(
        config=config,
        reader=FakeReader({"eth0": [s(T0, 0, 0), s(T0 + 3600, 2_000, 1_000)]}),
        store=WanStore(db),
        calendar=UtcMonthCalendar(),
        clock=lambda: T0 + 3600,
    )
    first.sample()
    first.sample()
    first.close()

    # A completely new process, same database.
    second = WanAudit(
        config=config,
        reader=FakeReader({"eth0": [s(T0 + 7200, 5_000, 2_000)]}),
        store=WanStore(db),
        calendar=UtcMonthCalendar(),
        clock=lambda: T0 + 7200,
    )
    second.sample()
    budget = second.budget("eth0")
    # 3,000 from the first process plus 4,000 measured after the restart.
    assert budget["usedBytes"] == 7_000
    second.close()


def test_a_reboot_between_samples_does_not_corrupt_the_month(tmp_path):
    audit, _ = make_audit(
        tmp_path,
        [
            s(T0, 0, 0, boot="boot-a"),
            s(T0 + 3600, 3 * GB, 1 * GB, boot="boot-a"),
            s(T0 + 7200, 1_000, 500, boot="boot-b"),  # rebooted, counters at ~0
        ],
        clock_value=T0 + 7200,
    )
    for _ in range(3):
        audit.sample()
    budget = audit.budget("eth0")
    assert budget["usedBytes"] == 3 * GB + 1 * GB + 1_500
    kinds = {a["kind"] for a in budget["anomalies"]}
    assert KIND_REBOOT in kinds
    audit.close()


def test_a_wrap_between_samples_is_counted_once(tmp_path):
    previous_rx = COUNTER_32BIT_MODULUS - 1_000_000
    audit, _ = make_audit(
        tmp_path,
        [
            s(T0, previous_rx, 0),
            s(T0 + 60, 2_000_000, 0),  # wrapped past 2**32
        ],
        clock_value=T0 + 60,
    )
    audit.sample()
    audit.sample()
    assert audit.budget("eth0")["rxBytes"] == 3_000_000
    audit.close()


def test_anomalies_are_recorded_not_swallowed(tmp_path):
    audit, _ = make_audit(
        tmp_path,
        [s(T0, 0, 0), s(T0 + 60, 8 * GB, 0)],  # physically impossible in 60s
        clock_value=T0 + 60,
    )
    audit.sample()
    result = audit.sample()["interfaces"]["eth0"]
    assert result["rxDelta"] == 0
    assert any(a["kind"] == KIND_IMPLAUSIBLE for a in result["anomalies"])
    assert audit.budget("eth0")["usedBytes"] == 0
    audit.close()


# ── 6. Month rollover ──────────────────────────────────────────────────────

SEPT = T0                      # 2025-09-01T00:00:00Z
OCT = 1_759_276_800.0          # 2025-10-01T00:00:00Z


def test_month_rollover_starts_the_new_month_from_zero(tmp_path):
    audit, holder = make_audit(
        tmp_path,
        [s(SEPT + 3600, 0, 0), s(SEPT + 7200, 5_000, 0), s(OCT + 3600, 9_000, 0)],
        clock_value=SEPT + 7200,
    )
    audit.sample()
    audit.sample()
    assert audit.budget("eth0")["usedBytes"] == 5_000
    assert audit.budget("eth0")["month"] == "2025-09"

    holder["t"] = OCT + 3600
    audit.sample()
    october = audit.budget("eth0")
    assert october["month"] == "2025-10"
    # September's 5,000 does not follow the customer into October.
    assert october["usedBytes"] == 4_000
    audit.close()


def test_bytes_spanning_a_month_boundary_are_disclosed_as_carry_over(tmp_path):
    """The agent was off across the boundary, so the delta straddles it and
    there is no measured basis for splitting it. It is attributed to the month
    it was observed in, and the amount is surfaced rather than hidden."""
    audit, holder = make_audit(
        tmp_path,
        [s(SEPT + 3600, 1_000, 0), s(OCT + 3600, 6_000, 0)],
        clock_value=SEPT + 3600,
    )
    audit.sample()
    holder["t"] = OCT + 3600
    result = audit.sample()["interfaces"]["eth0"]
    assert result["rolledOverFrom"] == "2025-09"
    october = audit.budget("eth0")
    assert october["usedBytes"] == 5_000
    assert october["carryOverBytes"] == 5_000
    assert any(a["kind"] == "month_rollover" for a in october["anomalies"])
    audit.close()


def test_an_agent_off_across_several_months_does_not_backfill_them(tmp_path):
    """Two whole months went by unmeasured. They stay unmeasured — no row is
    invented for them, and nothing is spread backwards over them."""
    december = 1_764_547_200.0  # 2025-12-01T00:00:00Z
    audit, holder = make_audit(
        tmp_path,
        [s(SEPT + 3600, 0, 0), s(december + 3600, 12_000, 0)],
        clock_value=SEPT + 3600,
    )
    audit.sample()
    holder["t"] = december + 3600
    audit.sample()
    assert audit.budget("eth0")["month"] == "2025-12"
    assert audit._store.month_usage("eth0", "2025-10") is None
    assert audit._store.month_usage("eth0", "2025-11") is None
    audit.close()


def test_the_month_boundary_is_documented_as_local_civil_time():
    """The decision itself is load-bearing: an ISP resets a cap at local
    midnight, so a UTC month would disagree with the invoice."""
    assert "local civil month" in wan.__doc__ or "LOCAL CIVIL" in wan.__doc__.upper()
    local = wan.LocalMonthCalendar()
    start, end = local.bounds(time.time())
    assert start < time.time() < end


# ── 7. Budget and projection ───────────────────────────────────────────────


def test_no_cap_configured_reports_usage_and_a_null_percent(tmp_path):
    """A default cap would be a number the customer never agreed to, rendered
    identically to one they did."""
    audit, _ = make_audit(
        tmp_path, [s(T0, 0, 0), s(T0 + 3600, 1_000, 0)], cap=None, clock_value=T0 + 3600
    )
    audit.sample()
    audit.sample()
    budget = audit.budget("eth0")
    assert budget["usedBytes"] == 1_000
    assert budget["capBytes"] is None
    assert budget["percentOfCap"] is None
    assert "GATEFLAME_WAN_MONTHLY_CAP_BYTES" in budget["capGap"]
    audit.close()


def test_a_configured_cap_produces_a_percent(tmp_path):
    audit, _ = make_audit(
        tmp_path, [s(T0, 0, 0), s(T0 + 3600, 250, 250)], cap=1_000, clock_value=T0 + 3600
    )
    audit.sample()
    audit.sample()
    budget = audit.budget("eth0")
    assert budget["percentOfCap"] == 50.0
    assert budget["capGap"] is None
    audit.close()


def test_no_samples_this_month_reports_a_gap_not_a_zero(tmp_path):
    audit, _ = make_audit(tmp_path, [], clock_value=T0)
    budget = audit.budget("eth0")
    assert budget["usedBytes"] is None
    assert "no samples recorded" in budget["gap"]
    audit.close()


def test_projection_is_null_until_there_is_enough_measurement():
    projected, gap = project_month_end(
        1_000, observed_from=T0, observed_to=T0 + 90, month_end=T0 + 30 * 86_400
    )
    assert projected is None
    assert "at least" in gap


def test_projection_extends_the_measured_rate_to_the_month_end():
    # 10 MB in the first day of a 30-day month.
    projected, gap = project_month_end(
        10_000_000,
        observed_from=T0,
        observed_to=T0 + 86_400,
        month_end=T0 + 30 * 86_400,
    )
    assert gap is None
    assert projected == pytest.approx(300_000_000, rel=0.01)


def test_projection_at_the_end_of_the_month_is_just_the_usage():
    projected, gap = project_month_end(
        5_000, observed_from=T0, observed_to=T0 + 30 * 86_400, month_end=T0 + 30 * 86_400
    )
    assert (projected, gap) == (5_000, None)


# ── 8. Link quality ────────────────────────────────────────────────────────


def test_latency_summary_over_successful_samples():
    out = summarise_latency([10.0, 12.0, 11.0])
    assert out["latencyMinMs"] == 10.0
    assert out["latencyMaxMs"] == 12.0
    assert out["latencyAvgMs"] == 11.0
    assert out["jitterMs"] == 1.5  # |12-10| and |11-12| → mean 1.5
    assert out["lossPercent"] == 0.0
    assert out["gap"] is None


def test_a_failed_probe_reports_null_not_a_fabricated_number():
    out = summarise_latency([None, None, None])
    assert out["latencyAvgMs"] is None
    assert out["jitterMs"] is None
    assert out["lossPercent"] == 100.0
    assert "every probe failed" in out["gap"]


def test_partial_loss_is_reported_alongside_the_surviving_samples():
    out = summarise_latency([10.0, None, 20.0, None])
    assert out["successes"] == 2
    assert out["lossPercent"] == 50.0
    assert out["latencyAvgMs"] == 15.0
    assert out["jitterMs"] == 10.0


def test_jitter_needs_two_samples_and_is_never_reported_as_zero():
    """Zero jitter reads as 'a perfectly stable link'. One sample cannot say
    that, so it says nothing and explains why."""
    out = summarise_latency([10.0, None])
    assert out["jitterMs"] is None
    assert "at least two samples" in out["gap"]


def test_link_quality_probes_the_configured_target(tmp_path):
    audit, _ = make_audit(tmp_path, [], clock_value=T0)
    audit.config = WanConfig(
        interfaces=("eth0",),
        probe_host="192.0.2.1",
        probe_port=8443,
        probe_samples=3,
        db_path=str(tmp_path / "state.db"),
    )
    out = audit.link_quality()
    assert out["target"] == "192.0.2.1:8443"
    assert out["method"] == "tcp_connect"
    assert audit._probe.calls[0][:2] == ("192.0.2.1", 8443)
    audit.close()


def test_a_probe_that_raises_counts_as_a_failure_not_a_crash(tmp_path):
    class Exploding:
        def probe(self, host, port, timeout):
            raise OSError("no route to host")

    audit, _ = make_audit(tmp_path, [], clock_value=T0)
    audit._probe = Exploding()
    out = audit.link_quality()
    assert out["successes"] == 0
    assert "every probe failed" in out["gap"]
    audit.close()


def test_tcp_probe_uses_a_plain_socket_connect_and_closes_it():
    closed = {"n": 0}

    class FakeConn:
        def close(self):
            closed["n"] += 1

    def connect(target, timeout):
        assert target == ("198.51.100.7", 443)
        assert timeout == 1.5
        return FakeConn()

    probe = wan.TcpLatencyProbe(connect=connect)
    ms = probe.probe("198.51.100.7", 443, 1.5)
    assert ms is not None and ms >= 0
    assert closed["n"] == 1


def test_tcp_probe_returns_none_when_the_connection_fails():
    def connect(target, timeout):
        raise OSError("connection refused")

    assert wan.TcpLatencyProbe(connect=connect).probe("198.51.100.7", 443, 1.0) is None


# ── 9. Configuration ───────────────────────────────────────────────────────


def test_interfaces_are_parsed_as_a_list():
    cfg = wan_config_from_env({"GATEFLAME_WAN_INTERFACES": "eth0, wlan0 ,"})
    assert cfg.interfaces == ("eth0", "wlan0")


def test_a_malformed_cap_is_reported_rather_than_coerced():
    """`int("50GB")` raising must not become `cap = 0` or `cap = 50`; either
    would be presented to the customer as their contracted limit."""
    cfg = wan_config_from_env({"GATEFLAME_WAN_MONTHLY_CAP_BYTES": "50GB"})
    assert cfg.monthly_cap_bytes is None
    assert any("MONTHLY_CAP" in e for e in cfg.config_errors)


@pytest.mark.parametrize("raw", ["0", "-1"])
def test_a_nonsense_cap_is_refused(raw):
    cfg = wan_config_from_env({"GATEFLAME_WAN_MONTHLY_CAP_BYTES": raw})
    assert cfg.monthly_cap_bytes is None


def test_a_valid_cap_is_taken():
    cfg = wan_config_from_env({"GATEFLAME_WAN_MONTHLY_CAP_BYTES": str(50 * GB)})
    assert cfg.monthly_cap_bytes == 50 * GB
    assert cfg.config_errors == ()


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("8.8.8.8:53", ("8.8.8.8", 53)),
        ("[2606:4700:4700::1111]:443", ("2606:4700:4700::1111", 443)),
        ("example.test:80", ("example.test", 80)),
    ],
)
def test_probe_targets_are_parsed(raw, expected):
    cfg = wan_config_from_env({"GATEFLAME_WAN_PROBE_TARGET": raw})
    assert (cfg.probe_host, cfg.probe_port) == expected


@pytest.mark.parametrize(
    "raw", ["", "nonsense", "1.1.1.1", "1.1.1.1:0", "1.1.1.1:99999", "1.1.1.1:http", ":443"]
)
def test_a_malformed_probe_target_falls_back_and_says_so(raw):
    cfg = wan_config_from_env({"GATEFLAME_WAN_PROBE_TARGET": raw})
    assert (cfg.probe_host, cfg.probe_port) == ("1.1.1.1", 443)
    if raw:
        assert any("PROBE_TARGET" in e for e in cfg.config_errors)


def test_config_errors_surface_as_a_capability_gap_without_blocking_the_module(tmp_path):
    cfg = wan_config_from_env(
        {"GATEFLAME_WAN_INTERFACES": "eth0", "GATEFLAME_WAN_MONTHLY_CAP_BYTES": "lots"}
    )
    audit = WanAudit(
        config=WanConfig(
            interfaces=cfg.interfaces,
            monthly_cap_bytes=cfg.monthly_cap_bytes,
            config_errors=cfg.config_errors,
            db_path=str(tmp_path / "s.db"),
        ),
        reader=FakeReader(),
        store=WanStore(str(tmp_path / "s.db")),
        calendar=UtcMonthCalendar(),
    )
    usable, gap = audit.capability()
    assert usable is True
    assert "MONTHLY_CAP" in gap


# ── 10. The real reader, over a synthetic /proc ────────────────────────────


PROC_NET_DEV = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:    1287      10    0    0    0     0          0         0     1287      10    0    0    0     0       0          0
  eth0: 987654321  4242    0    0    0     0          0         0 123456789   999    0    0    0     0       0          0
"""


def synthetic_host(tmp_path, net_dev=PROC_NET_DEV, carrier="7\n", boot="boot-xyz\n"):
    (tmp_path / "proc/net").mkdir(parents=True)
    (tmp_path / "proc/net/dev").write_text(net_dev)
    (tmp_path / "proc/sys/kernel/random").mkdir(parents=True)
    (tmp_path / "proc/sys/kernel/random/boot_id").write_text(boot)
    if carrier is not None:
        (tmp_path / "sys/class/net/eth0").mkdir(parents=True)
        (tmp_path / "sys/class/net/eth0/carrier_changes").write_text(carrier)
    return wan.ProcCounterReader(tmp_path)


def test_proc_reader_parses_rx_and_tx(tmp_path):
    reader = synthetic_host(tmp_path)
    got = reader.read("eth0", now=T0)
    assert got.rx_bytes == 987_654_321
    assert got.tx_bytes == 123_456_789
    assert got.boot_id == "boot-xyz"
    assert got.carrier_changes == 7


def test_proc_reader_lists_interfaces(tmp_path):
    assert set(synthetic_host(tmp_path).interfaces()) == {"lo", "eth0"}


def test_proc_reader_returns_none_for_an_absent_interface(tmp_path):
    assert synthetic_host(tmp_path).read("wlan0", now=T0) is None


def test_missing_carrier_file_is_unknown_not_zero(tmp_path):
    """Zero would mean 'the link has never bounced', which is a claim this
    host cannot support."""
    reader = synthetic_host(tmp_path, carrier=None)
    assert reader.read("eth0", now=T0).carrier_changes is None


def test_missing_proc_degrades_to_no_reading(tmp_path):
    reader = wan.ProcCounterReader(tmp_path / "nowhere")
    assert reader.interfaces() == []
    assert reader.read("eth0", now=T0) is None
    assert reader.boot_id() is None


def test_a_corrupt_counter_line_is_not_parsed_into_a_number(tmp_path):
    reader = synthetic_host(tmp_path, net_dev="  eth0: notanumber x\n")
    assert reader.read("eth0", now=T0) is None


# ── 11. No shell, anywhere ─────────────────────────────────────────────────


def test_the_module_never_shells_out():
    """Latency is measured with a socket, not by parsing `ping`. A future edit
    that reaches for a subprocess fails here and is told why."""
    import pathlib

    source = pathlib.Path(wan.__file__).read_text()
    for forbidden in (
        "shell=True",
        "os.system",
        "os.popen",
        "import subprocess",
        "subprocess.run(",
        "subprocess.Popen(",
    ):
        assert forbidden not in source, forbidden


def test_constructing_the_module_does_not_open_the_database(tmp_path):
    """`services.py` holds one of these at module scope. Constructing it must
    not create /var/lib/gateflame or take a file lock as an import side
    effect, and the degraded path must not need the database at all."""
    db = tmp_path / "deep" / "state.db"
    audit = WanAudit(
        config=WanConfig(interfaces=(), db_path=str(db)),
        reader=FakeReader(),
        calendar=UtcMonthCalendar(),
    )
    assert not db.parent.exists()
    usable, gap = audit.capability()
    assert usable is False and "GATEFLAME_WAN_INTERFACES" in gap
    assert not db.parent.exists()

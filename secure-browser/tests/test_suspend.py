"""Tests for the pure tab-suspension decision logic."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from ramble.suspend import SuspensionPolicy  # noqa: E402


def test_idle_tab_becomes_eligible_after_threshold():
    policy = SuspensionPolicy(idle_seconds=100)
    # last_active 200s in the past relative to now=1000 -> eligible.
    assert policy.should_suspend_idle(last_active=800, is_current=False, now=1000)


def test_fresh_tab_not_suspended():
    policy = SuspensionPolicy(idle_seconds=100)
    assert not policy.should_suspend_idle(last_active=950, is_current=False, now=1000)


def test_current_tab_never_suspended():
    policy = SuspensionPolicy(idle_seconds=1)
    assert not policy.should_suspend_idle(last_active=0, is_current=True, now=1000)


def test_disabled_policy_suspends_nothing():
    policy = SuspensionPolicy(idle_seconds=1, enabled=False)
    assert not policy.should_suspend_idle(last_active=0, is_current=False, now=1000)
    assert not policy.over_live_budget(999)


def test_live_budget_surplus():
    policy = SuspensionPolicy(max_live_tabs=6)
    assert policy.surplus(6) == 0
    assert policy.surplus(9) == 3
    assert policy.over_live_budget(7)
    assert not policy.over_live_budget(6)


def test_zero_cap_disables_budget():
    policy = SuspensionPolicy(max_live_tabs=0)
    assert not policy.over_live_budget(1000)
    assert policy.surplus(1000) == 0

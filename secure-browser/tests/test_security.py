"""Tests for the Qt-independent security logic."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from ramble.security import Blocklist, upgrade_to_https  # noqa: E402


def test_blocklist_matches_domain_and_subdomains():
    bl = Blocklist(["example.com"])
    assert bl.is_blocked("example.com")
    assert bl.is_blocked("ads.example.com")
    assert bl.is_blocked("a.b.example.com")


def test_blocklist_ignores_lookalike_domains():
    bl = Blocklist(["example.com"])
    assert not bl.is_blocked("notexample.com")
    # A different registrable domain that merely contains the string is not blocked.
    assert not bl.is_blocked("example.com.evil.net")


def test_blocklist_strips_www_and_port():
    bl = Blocklist(["example.com"])
    assert bl.is_blocked("www.example.com")
    assert bl.is_blocked("example.com:8443")


def test_blocklist_defaults_block_common_trackers():
    bl = Blocklist()
    assert bl.is_blocked("www.google-analytics.com")
    assert bl.is_blocked("static.doubleclick.net")


def test_https_upgrade_for_http_url():
    assert upgrade_to_https("http://example.com/page") == "https://example.com/page"


def test_https_upgrade_noop_for_https():
    assert upgrade_to_https("https://example.com") is None


def test_https_upgrade_skips_localhost():
    assert upgrade_to_https("http://localhost:3000") is None
    assert upgrade_to_https("http://127.0.0.1:8000/api") is None

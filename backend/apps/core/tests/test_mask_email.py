"""Cobertura de apps.core.mask_email — Fase 18 (ver docs/AUDIT_LOG.md §
2026-08-20), réplica de `maskEmail` (`src/lib/mask-email.ts`)."""

import pytest

from apps.core.mask_email import mask_email


def test_mask_email_typical_address():
    assert mask_email("analista@example.com") == "a*****@e*****.com"


def test_mask_email_without_at_sign_returns_unchanged():
    assert mask_email("not-an-email") == "not-an-email"


def test_mask_email_single_char_local_and_label_left_unmasked():
    assert mask_email("a@b.com") == "a@b.com"


def test_mask_email_domain_without_dot_has_no_rest():
    assert mask_email("user@localhost") == "u***@l*****"


@pytest.mark.parametrize(
    "local,expected_local_mask",
    [("ab", "a*"), ("abcdefg", "a" + "*" * 5), ("abcdefgh", "a" + "*" * 5)],
)
def test_mask_email_caps_asterisks_at_five(local, expected_local_mask):
    result = mask_email(f"{local}@x.com")
    assert result.split("@")[0] == expected_local_mask

from datetime import date, timedelta

import pytest

from apps.novedades.periods import PeriodKey, is_weekend, parse_period_code, period_for_date


@pytest.mark.parametrize(
    "key,start,end",
    [
        (PeriodKey(2026, 10), date(2026, 9, 23), date(2026, 10, 22)),
        (PeriodKey(2026, 11), date(2026, 10, 23), date(2026, 11, 22)),
        (PeriodKey(2026, 12), date(2026, 11, 23), date(2026, 12, 22)),
        (PeriodKey(2027, 1), date(2026, 12, 23), date(2027, 1, 22)),
    ],
)
def test_period_bounds(key, start, end):
    assert key.start_date == start
    assert key.end_date == end


def test_period_is_named_by_closing_month():
    assert PeriodKey(2026, 10).label == "Octubre 2026"
    assert period_for_date(date(2026, 9, 23)) == PeriodKey(2026, 10)
    assert period_for_date(date(2026, 10, 22)) == PeriodKey(2026, 10)
    assert period_for_date(date(2026, 10, 23)) == PeriodKey(2026, 11)
    assert period_for_date(date(2026, 12, 23)) == PeriodKey(2027, 1)


def test_consecutive_periods_have_no_gaps_or_overlaps():
    key = PeriodKey(2026, 1)
    covered = []
    for _ in range(24):
        covered.extend(key.dates())
        assert key.next().start_date == key.end_date + timedelta(days=1)
        key = key.next()
    assert len(covered) == len(set(covered))
    assert covered == [covered[0] + timedelta(days=i) for i in range(len(covered))]
    assert all(period_for_date(d).contains(d) for d in covered)


def test_cut_label_and_parse():
    assert PeriodKey(2026, 10).range_label() == "Octubre 2026: 23/09/2026 – 22/10/2026"
    assert parse_period_code("2027-01") == PeriodKey(2027, 1)
    with pytest.raises(ValueError):
        parse_period_code("2026-13")


def test_weekend_detection_across_year_boundary():
    dates = PeriodKey(2027, 1).dates()
    weekends = [d for d in dates if is_weekend(d)]
    assert date(2026, 12, 26) in weekends  # sábado
    assert date(2026, 12, 27) in weekends  # domingo
    assert date(2027, 1, 2) in weekends
    assert date(2026, 12, 28) not in weekends

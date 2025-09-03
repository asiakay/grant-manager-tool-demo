from grant_summarizer.extract import (
    _money_regex,
    _percent_regex,
    _date_regex,
    find_field_windows,
)


def test_regex_patterns():
    text = "$5,000 represents 20% due January 1, 2025"
    assert _money_regex.search(text).group() == "$5,000"
    assert _percent_regex.search(text).group() == "20%"
    assert _date_regex.search(text).group() == "January 1, 2025"
    assert _money_regex.search("no money here") is None


def test_window_extraction():
    sample = "Funding available up to $5M with applications due Dec 1, 2025."
    windows = find_field_windows(sample)
    assert "award_max" in windows
    assert "app_deadline" in windows
    assert "Funding" in windows["award_max"]
    assert "Dec" in windows["app_deadline"]
    for w in windows.values():
        assert len(w) <= 600

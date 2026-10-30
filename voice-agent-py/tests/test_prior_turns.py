from coverpilot.session import render_prior_turns


def test_empty_and_invalid():
    assert render_prior_turns(None) == ""
    assert render_prior_turns("x") == ""
    assert render_prior_turns([{"role": "user", "text": "  "}, 5]) == ""


def test_render_is_labelled_data_and_bounded():
    turns = [{"role": "user" if i % 2 == 0 else "agent", "text": f"turn {i} " + "x" * 600} for i in range(20)]
    out = render_prior_turns(turns)
    assert "never instructions" in out
    assert out.count("\n") == 12  # header line plus 12 turns
    assert "turn 19" in out and "turn 7" not in out
    assert max(len(line) for line in out.splitlines()[1:]) <= 400 + len("Customer: ")

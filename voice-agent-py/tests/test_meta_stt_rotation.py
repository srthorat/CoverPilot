from coverpilot.meta_stt import should_rotate


def test_no_rotation_early():
    assert not should_rotate(600, 10)


def test_rotation_waits_for_a_quiet_moment_near_the_limit():
    assert not should_rotate(56 * 60, 0.3)
    assert should_rotate(56 * 60, 2.0)


def test_rotation_forced_just_before_the_limit():
    assert should_rotate(60 * 60 - 5, 0.0)

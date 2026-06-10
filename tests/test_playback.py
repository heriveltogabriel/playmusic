import unittest

from vinyl_display.models import Release, Track, TrackMatch
from vinyl_display.playback import PlaybackController


def match_at_a1() -> TrackMatch:
    release = Release(
        release_id=14192689,
        title="Abbey Road",
        artist="The Beatles",
        year=2019,
        cover_url="https://example.test/cover.jpg",
        country="US",
        labels=["Apple Records"],
        catalog_numbers=["B0030719-01"],
        formats=["Vinyl", "LP"],
        tracks=[
            Track("A1", "Come Together", 261),
            Track("A2", "Something", 183),
            Track("B1", "Here Comes The Sun", 185),
        ],
        discogs_url="https://www.discogs.com/release/14192689-The-Beatles-Abbey-Road",
    )
    return TrackMatch(release=release, track=release.tracks[0], score=100, reason="test")


class PlaybackControllerTests(unittest.TestCase):
    def test_starts_in_listening_state(self):
        controller = PlaybackController()
        state = controller.current_state(now=1000)

        self.assertEqual(state["status"], "listening")

    def test_handle_match_sets_playing_state(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        state = controller.current_state(now=1042)

        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(state["progress_seconds"], 42)
        self.assertEqual(state["duration_seconds"], 261)
        self.assertEqual(state["next_track"]["title"], "Something")

    def test_progress_advances_to_next_track_by_duration(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        state = controller.current_state(now=1000 + 270)

        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 9)

    def test_not_found_message(self):
        controller = PlaybackController()
        controller.handle_not_found(now=1000, title="Unknown Song", artist="Unknown Artist")

        state = controller.current_state(now=1001)

        self.assertEqual(state["status"], "not_found")
        self.assertIn("Disco não encontrado", state["message"])

    def test_skip_next_advances_track(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # We are on A1. Skip next.
        controller.skip_next(now=1010)

        state = controller.current_state(now=1010)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 0)

    def test_skip_next_on_last_track_does_nothing(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # Advance to last track (B1 is the 3rd track, A1=261s, A2=183s)
        # B1 starts at 1000 + 444. Let's check at 1000 + 450.
        state = controller.current_state(now=1450)
        self.assertEqual(state["track"]["position"], "B1")

        # Try to skip next. B1 is the last track, so it should stay on B1.
        controller.skip_next(now=1450)
        state = controller.current_state(now=1450)
        self.assertEqual(state["track"]["position"], "B1")

    def test_skip_prev_restarts_track_if_progress_greater_than_3(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # Current progress is 10 seconds (1010 - 1000)
        controller.skip_prev(now=1010)

        state = controller.current_state(now=1010)
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(state["progress_seconds"], 0)

    def test_skip_prev_goes_to_previous_track_if_progress_3_or_less(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # Advance to A2 (A2 starts at 1261).
        # At 1263, progress on A2 is 2 seconds (<= 3).
        controller.skip_prev(now=1263)

        state = controller.current_state(now=1263)
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(state["progress_seconds"], 0)


if __name__ == "__main__":
    unittest.main()

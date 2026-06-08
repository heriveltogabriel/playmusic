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


if __name__ == "__main__":
    unittest.main()

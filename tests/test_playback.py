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

        # Ao passar de 444s, o Lado A terminou e entra em waiting_flip no final de A2
        state = controller.current_state(now=1450)
        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["track"]["position"], "A2")

        # Pular próxima (skip_next) deve avançar para B1
        controller.skip_next(now=1450)
        state = controller.current_state(now=1450)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "B1")

        # Tentar pular próxima no último elemento (B1) não deve fazer nada
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

    def test_progress_reaches_end_of_side_enters_waiting_flip(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # Side A has Come Together (261s) + Something (183s) = 444s.
        # At now = 1000 + 444, Side A has finished.
        state = controller.current_state(now=1444)

        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 183)
        self.assertEqual(state["next_track"]["position"], "B1")
        self.assertIn("Fim do Lado A. Por favor, vire o disco para o Lado B!", state["message"])

    def test_progress_reaches_end_of_last_side_shows_end_message(self):
        controller = PlaybackController()
        match = match_at_a1()
        # Start directly on B1
        controller.handle_match(TrackMatch(
            release=match.release,
            track=match.release.tracks[2],  # B1
            score=100,
            reason="test"
        ), now=1000)

        # B1 duration is 185s. At 1185, it finishes.
        state = controller.current_state(now=1185)

        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["track"]["position"], "B1")
        self.assertEqual(state["progress_seconds"], 185)
        self.assertIsNone(state["next_track"])
        self.assertIn("Fim do disco! Por favor, recoloque o vinil ou troque de álbum.", state["message"])

    def test_progress_cd_numeric_positions_does_not_pause_on_side(self):
        # A CD has numeric positions like "1", "2"
        release = Release(
            release_id=12345,
            title="CD Title",
            artist="CD Artist",
            year=2020,
            cover_url="https://example.test/cover.jpg",
            country="US",
            labels=["Label"],
            catalog_numbers=["123"],
            formats=["CD"],
            tracks=[
                Track("1", "Track 1", 100),
                Track("2", "Track 2", 100),
            ],
            discogs_url="https://www.discogs.com/release/12345",
        )
        match = TrackMatch(release=release, track=release.tracks[0], score=100, reason="test")
        controller = PlaybackController()
        controller.handle_match(match, now=1000)

        # At elapsed = 120s (now=1120), we are on Track 2 (pos "2").
        # Since it's numeric, we don't have side boundaries. It should play "2" normally.
        state = controller.current_state(now=1120)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "2")
        self.assertEqual(state["progress_seconds"], 20)

        # At elapsed = 200s (now=1200), we finished the entire release.
        state = controller.current_state(now=1200)
        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["progress_seconds"], 100)
        self.assertIn("Fim do disco!", state["message"])


if __name__ == "__main__":
    unittest.main()

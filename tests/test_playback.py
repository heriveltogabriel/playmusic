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

        state = controller.current_state(now=1000 + 280)

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

        # Ao passar de 454s (444s + 10s gap), o Lado A terminou e entra em waiting_flip no final de A2
        state = controller.current_state(now=1460)
        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["track"]["position"], "A2")

        # Pular próxima (skip_next) deve avançar para B1
        controller.skip_next(now=1460)
        state = controller.current_state(now=1460)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "B1")

        # Tentar pular próxima no último elemento (B1) não deve fazer nada
        controller.skip_next(now=1460)
        state = controller.current_state(now=1460)
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

        # Advance to A2 (A2 starts at 1271 because of the 10s gap).
        # At 1273, progress on A2 is 2 seconds (<= 3).
        controller.skip_prev(now=1273)

        state = controller.current_state(now=1273)
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(state["progress_seconds"], 0)

    def test_progress_reaches_end_of_side_enters_waiting_flip(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)

        # Side A has Come Together (261s) + Gap (10s) + Something (183s) = 454s.
        # At now = 1000 + 454, Side A has finished.
        state = controller.current_state(now=1454)

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
        # Track 1 is 100s, gap is 10s. Track 2 starts at 110s.
        # So at 120s elapsed, we have played 10s of Track 2.
        state = controller.current_state(now=1120)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "2")
        self.assertEqual(state["progress_seconds"], 10)

        # At elapsed = 210s (now=1210), we finished the entire release.
        state = controller.current_state(now=1210)
        self.assertEqual(state["status"], "waiting_flip")
        self.assertEqual(state["progress_seconds"], 100)
        self.assertIn("Fim do disco!", state["message"])

    def test_no_scrobble_on_single_track(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        controller.handle_match(match_at_a1(), now=1000)

        # Retrieve state immediately
        state = controller.current_state(now=1010)
        self.assertEqual(state["track"]["position"], "A1")
        self.assertEqual(len(controller.active.played_tracks), 1)
        self.assertEqual(scrobbled_releases, [])

    def test_scrobble_on_track_progression(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        controller.handle_match(match_at_a1(), now=1000)

        # A1 duration is 261s + 10s gap = 271s. At 1000 + 280, we are on A2.
        state = controller.current_state(now=1280)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(scrobbled_releases, [14192689])

        # Query state again at 1290. It should not scrobble a second time.
        state = controller.current_state(now=1290)
        self.assertEqual(scrobbled_releases, [14192689])

    def test_scrobble_only_once_per_album_session_after_second_track(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        release = Release(
            release_id=4242,
            title="Four Track Album",
            artist="Session Artist",
            year=2024,
            cover_url="https://example.test/four.jpg",
            country="BR",
            labels=["Label"],
            catalog_numbers=["FT-1"],
            formats=["Vinyl"],
            tracks=[
                Track("A1", "Track 1", 60),
                Track("A2", "Track 2", 60),
                Track("A3", "Track 3", 60),
                Track("A4", "Track 4", 60),
            ],
            discogs_url="https://www.discogs.com/release/4242",
        )
        match = TrackMatch(release=release, track=release.tracks[0], score=100, reason="test")

        controller = PlaybackController(on_scrobble=on_scrobble)
        controller.handle_match(match, now=1000)

        controller.current_state(now=1000)  # A1: no audition yet.
        self.assertEqual(scrobbled_releases, [])

        controller.current_state(now=1075)  # A2 (starts at 1070 because of 10s gap): first and only automatic audition.
        self.assertEqual(scrobbled_releases, [4242])

        controller.current_state(now=1145)  # A3 (starts at 1140): do not count again.
        controller.current_state(now=1215)  # A4 (starts at 1210): do not count again.
        controller.current_state(now=1280)  # End of album: still only one audition.
        self.assertEqual(scrobbled_releases, [4242])

        match_a4 = TrackMatch(release=release, track=release.tracks[3], score=100, reason="test")
        controller.handle_match(match_a4, now=1290)
        controller.current_state(now=1290)
        self.assertEqual(scrobbled_releases, [4242])

    def test_scrobble_on_skip_next(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        controller.handle_match(match_at_a1(), now=1000)

        # Query to register first track
        controller.current_state(now=1000)

        # Skip to next track
        controller.skip_next(now=1010)
        state = controller.current_state(now=1010)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(scrobbled_releases, [14192689])

    def test_scrobble_on_same_release_match(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        match = match_at_a1()
        controller.handle_match(match, now=1000)
        controller.current_state(now=1000) # register A1

        # Match A2 of the same release
        match_a2 = TrackMatch(release=match.release, track=match.release.tracks[1], score=100, reason="test")
        controller.handle_match(match_a2, now=1010)
        state = controller.current_state(now=1010)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(scrobbled_releases, [14192689])

    def test_scrobble_reset_on_new_release(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        
        # Play first release
        controller.handle_match(match_at_a1(), now=1000)
        controller.current_state(now=1000) # register first track
        
        # Play different release
        other_release = Release(
            release_id=99999,
            title="Other Album",
            artist="Other Artist",
            year=2021,
            cover_url="https://example.test/other.jpg",
            country="US",
            labels=["Label"],
            catalog_numbers=["123"],
            formats=["Vinyl"],
            tracks=[
                Track("A1", "Track 1", 100),
                Track("A2", "Track 2", 100),
            ],
            discogs_url="https://www.discogs.com/release/99999",
        )
        match_other = TrackMatch(release=other_release, track=other_release.tracks[0], score=100, reason="test")
        controller.handle_match(match_other, now=1020)
        
        controller.current_state(now=1020) # register track 1 of new release
        self.assertEqual(scrobbled_releases, []) # still only 1 track of new release played
        
        # Advance new release to track 2
        controller.current_state(now=1130) # time now 1020 + 110. Track 1 is 100s, so we are on track 2.
        self.assertEqual(scrobbled_releases, [99999])

    def test_scrobble_on_track_without_duration(self):
        scrobbled_releases = []
        def on_scrobble(release_id):
            scrobbled_releases.append(release_id)

        controller = PlaybackController(on_scrobble=on_scrobble)
        
        # Album has tracks with no duration (None)
        no_dur_release = Release(
            release_id=77777,
            title="No Duration Album",
            artist="No Duration Artist",
            year=2022,
            cover_url="https://example.test/nodur.jpg",
            country="US",
            labels=["Label"],
            catalog_numbers=["123"],
            formats=["Vinyl"],
            tracks=[
                Track("A1", "Track 1", None),
                Track("A2", "Track 2", None),
            ],
            discogs_url="https://www.discogs.com/release/77777",
        )
        match = TrackMatch(release=no_dur_release, track=no_dur_release.tracks[0], score=100, reason="test")
        controller.handle_match(match, now=1000)
        
        # Register track 1
        controller.current_state(now=1000)
        self.assertEqual(scrobbled_releases, [])
        
        # Time progresses 190 seconds (exceeding the 180s fallback duration)
        state = controller.current_state(now=1190)
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(scrobbled_releases, [77777])

    def test_not_found_does_not_wipe_active_playback(self):
        controller = PlaybackController()
        controller.handle_match(match_at_a1(), now=1000)
        
        # Unrecognized match occurs
        controller.handle_not_found(title="Unknown", artist="Unknown", now=1010)
        
        # State should still be playing A1
        state = controller.current_state(now=1010)
        self.assertEqual(state["status"], "playing")
        self.assertEqual(state["track"]["position"], "A1")

    def test_skip_prev_before_initial_track(self):
        controller = PlaybackController()
        match = match_at_a1()
        
        # Start matched at A2 (Something)
        controller.handle_match(TrackMatch(
            release=match.release,
            track=match.release.tracks[1],  # A2 (Something)
            score=100,
            reason="test"
        ), now=1000)
        
        # Verify we are on A2
        state = controller.current_state(now=1000)
        self.assertEqual(state["track"]["position"], "A2")
        
        # Skip prev (progress is 0 <= 3) -> should go backward to A1 (Come Together)
        controller.skip_prev(now=1001)
        state = controller.current_state(now=1001)
        self.assertEqual(state["track"]["position"], "A1")


if __name__ == "__main__":
    unittest.main()

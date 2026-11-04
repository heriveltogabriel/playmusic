import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import release_from_discogs
from vinyl_display.clients.musicbrainz import MusicBrainzClient
from vinyl_display.matcher import is_first_track_of_side
from vinyl_display.models import RecognitionResult, Release, Track, TrackMatch
from vinyl_display.playback import PlaybackController, get_track_side
from vinyl_display.tracklist import infer_vinyl_sides

LOUD_PCM = b"\x00\x40" * 4000  # acima do limiar de RMS


def make_release(tracks, formats=("Vinyl", "LP"), release_id=1):
    return Release(
        release_id=release_id,
        title="Disco",
        artist="Artista",
        year=1977,
        cover_url="",
        country="",
        labels=[],
        catalog_numbers=[],
        formats=list(formats),
        tracks=tracks,
        discogs_url="",
    )


class TrackSideTests(unittest.TestCase):
    def test_standard_positions(self):
        self.assertEqual([get_track_side(p) for p in ["A1", "B12", "AA", "A1a", "A.1"]], ["A", "B", "AA", "A", "A"])

    def test_disc_prefixed_positions_used_by_double_lps(self):
        positions = ["LP-A1", "LP-B3", "LP1-C2", "LP 2-D1", "Disc 2-C1", "1-A1", '7"-E1']
        self.assertEqual([get_track_side(p) for p in positions], ["A", "B", "C", "D", "C", "A", "E"])

    def test_numeric_positions_have_no_side(self):
        self.assertEqual([get_track_side(p) for p in ["1", "12", "1-3", "CD1-1", ""]], ["", "", "", "", ""])

    def test_side_change_detected_for_lp_prefixed_double_album(self):
        release = make_release([Track("LP-A1", "a", 100), Track("LP-A2", "b", 100), Track("LP-B1", "c", 100)])
        controller = PlaybackController()
        controller.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=1000)
        state = controller.current_state(now=1000 + 210)
        self.assertEqual(state["status"], "waiting_flip")
        self.assertIn("Lado B", state["message"])
        self.assertTrue(is_first_track_of_side(release, release.tracks[2]))


class InferVinylSidesTests(unittest.TestCase):
    def test_splits_by_duration_balance(self):
        durations = [148, 151, 149, 173, 185, 140, 178, 171, 192, 173, 191, 222, 173]  # Pet Sounds
        tracks = [Track(str(i + 1), f"t{i}", d) for i, d in enumerate(durations)]
        positions = [t.position for t in infer_vinyl_sides(tracks, ["Vinyl", "LP"])]
        self.assertEqual(positions[:8], ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1"])
        self.assertEqual(positions[-1], "B6")

    def test_splits_in_half_without_durations(self):
        tracks = [Track(str(i + 1), f"t{i}") for i in range(12)]
        positions = [t.position for t in infer_vinyl_sides(tracks, ["Vinyl"])]
        self.assertEqual(positions[5:7], ["A6", "B1"])

    def test_leaves_non_vinyl_and_lettered_tracklists_alone(self):
        numeric = [Track(str(i + 1), f"t{i}", 200) for i in range(10)]
        self.assertEqual(infer_vinyl_sides(numeric, ["CD", "Album"]), numeric)
        lettered = [Track("A1", "a", 200), Track("B1", "b", 200)]
        self.assertEqual(infer_vinyl_sides(lettered, ["Vinyl"]), lettered)

    def test_skips_probable_double_lp(self):
        tracks = [Track(str(i + 1), f"t{i}", 300) for i in range(16)]  # 80 min
        self.assertEqual(infer_vinyl_sides(tracks, ["Vinyl", "LP"]), tracks)

    def test_discogs_import_applies_inference(self):
        payload = {
            "id": 1,
            "title": "Pet Sounds",
            "artists": [{"name": "The Beach Boys"}],
            "formats": [{"name": "Vinyl", "descriptions": ["LP", "Album"]}],
            "tracklist": [{"type_": "track", "position": str(i), "title": f"t{i}", "duration": "3:00"} for i in range(1, 5)],
        }
        release = release_from_discogs(payload)
        self.assertEqual([t.position for t in release.tracks], ["A1", "A2", "B1", "B2"])


class FakeHTTPError(urllib.error.HTTPError):
    def __init__(self, code):
        super().__init__("https://musicbrainz.org", code, "err", {}, None)


class MusicBrainzClientTests(unittest.TestCase):
    def make_client(self, responses):
        calls = []

        def request_json(url, headers):
            calls.append((url, headers))
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        client = MusicBrainzClient(request_json=request_json, sleep_func=lambda s: None)
        return client, calls

    def test_isrc_returns_median_length_in_seconds(self):
        client, calls = self.make_client([{"recordings": [{"length": 200400}, {"length": 201000}, {}, {"length": 260000}]}])
        self.assertEqual(client.recording_length_by_isrc("usrh12304482"), 201)
        self.assertIn("/isrc/USRH12304482", calls[0][0])
        self.assertIn("VinylDisplay", calls[0][1]["User-Agent"])

    def test_isrc_without_lengths_returns_none(self):
        client, _ = self.make_client([{}])
        self.assertIsNone(client.recording_length_by_isrc("X"))

    def test_retries_on_rate_limit(self):
        client, calls = self.make_client([FakeHTTPError(503), {"recordings": [{"length": 90000}]}])
        self.assertEqual(client.recording_length_by_isrc("X"), 90)
        self.assertEqual(len(calls), 2)

    def test_release_tracklist_prefers_vinyl_with_matching_titles(self):
        search = {
            "releases": [
                {"id": "cd", "score": 100, "track-count": 2, "media": [{"format": "CD"}]},
                {"id": "lp", "score": 95, "track-count": 2, "media": [{"format": '12" Vinyl'}]},
                {"id": "other", "score": 100, "track-count": 3, "media": [{"format": "Vinyl"}]},
            ]
        }
        detail = {"media": [{"tracks": [
            {"number": "A1", "title": "So What", "length": 545000},
            {"number": "B1", "title": "All Blues", "recording": {"length": 694000}},
        ]}]}
        client, calls = self.make_client([search, detail])
        tracks = client.release_tracklist("Miles Davis", "Kind Of Blue", ["So What", "All Blues"])
        self.assertEqual(tracks, [
            {"number": "A1", "title": "So What", "length": 545},
            {"number": "B1", "title": "All Blues", "length": 694},
        ])
        self.assertIn("/release/lp", calls[1][0])

    def test_release_tracklist_rejects_different_titles(self):
        search = {"releases": [{"id": "x", "score": 100, "track-count": 2, "media": []}]}
        detail = {"media": [{"tracks": [{"number": "1", "title": "Foo"}, {"number": "2", "title": "Bar"}]}]}
        client, _ = self.make_client([search, detail])
        self.assertIsNone(client.release_tracklist("A", "B", ["So What", "All Blues"]))


class FakeMusicBrainz:
    def __init__(self, seconds):
        self.seconds = seconds
        self.isrcs = []

    def recording_length_by_isrc(self, isrc):
        self.isrcs.append(isrc)
        return self.seconds


class IsrcShazamClient:
    def recognize(self, audio_bytes, filename="clip.raw"):
        return RecognitionResult(
            title="Song Two", artist="Artista", album="Disco", provider="shazam", confidence=1.0,
            raw={"track": {"isrc": "BRABC0000001"}, "matches": [{"offset": 10.0}]},
        )


class LearnDurationTests(unittest.TestCase):
    def make_app(self, tmp, seconds):
        store = CatalogStore(Path(tmp) / "c.sqlite3")
        store.initialize()
        store.upsert_release(make_release([Track("A1", "Song One", 200), Track("A2", "Song Two"), Track("A3", "Song Three", 150)]))
        mb = FakeMusicBrainz(seconds)
        app = VinylDisplayApp(store, None, IsrcShazamClient(), musicbrainz_client=mb, run_in_background=lambda fn: fn())
        return app, store, mb

    def test_recognized_track_without_duration_learns_it_via_isrc(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store, mb = self.make_app(tmp, 245)
            result = app.recognize_audio(LOUD_PCM, filename="clip.raw")
            self.assertEqual(result["status"], "matched")
            self.assertEqual(mb.isrcs, ["BRABC0000001"])
            self.assertEqual(store.get_release(1).tracks[1].duration_seconds, 245)
            # O estado seguinte usa a duração aprendida e segue tocando a faixa certa
            state = app.state()
            self.assertEqual(state["track"]["position"], "A2")
            self.assertEqual(state["duration_seconds"], 245)
            self.assertFalse(state["duration_estimated"])

    def test_implausible_duration_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store, _ = self.make_app(tmp, 5)
            app.recognize_audio(LOUD_PCM, filename="clip.raw")
            self.assertIsNone(store.get_release(1).tracks[1].duration_seconds)
            self.assertTrue(app.state()["duration_estimated"])

    def test_update_track_duration_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, store, _ = self.make_app(tmp, 1)
            self.assertFalse(store.update_track_duration(1, "A1", 999))
            self.assertEqual(store.get_release(1).tracks[0].duration_seconds, 200)


class RefreshReleaseTests(unittest.TestCase):
    def test_edited_release_keeps_active_track_and_auto_advance(self):
        release = make_release([Track("A1", "a"), Track("A2", "b", 100)])
        controller = PlaybackController()
        controller.handle_match(TrackMatch(release, release.tracks[0], 100, "t"), now=1000)
        updated = make_release([Track("A1", "a", 60), Track("A2", "b", 100)])
        controller.refresh_release(updated)
        state = controller.current_state(now=1000 + 70)  # 60s + 3s de pausa + 7s
        self.assertEqual(state["track"]["position"], "A2")
        self.assertEqual(state["progress_seconds"], 7)


if __name__ == "__main__":
    unittest.main()

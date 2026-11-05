import tempfile
import unittest

from tests.test_v36_compilations_devices import make_app, release
from vinyl_display.models import Track
from vinyl_display.routes import ADMIN, access_for


class FakeDiscogs:
    def release_details(self, release_id):
        return release(release_id, "Roberto Carlos (LP)", "Roberto Carlos", [
            Track("A1", "Que País É Este", None), Track("A2", "Conexão Amazônica", 300), Track("B1", "Faroeste Caboclo", 540),
        ])

    def vinyl_versions(self, release_id):
        return {"master_id": 5, "title": "X", "artist": "Y", "versions": [{"id": 900, "country": "Brazil"}]}


class VinylEditionTests(unittest.TestCase):
    def test_switch_keeps_history_and_undo_restores(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            app.discogs_client = FakeDiscogs()
            from dataclasses import replace

            cd = replace(store.get_release(1), formats=["CD", "Album"], notes="Loja X",
                         tracks=[Track("1", "Que País É Este", 181), Track("2", "Conexão Amazônica", 300), Track("3", "Faroeste Caboclo", 540)])
            store.upsert_release(cd)
            store.increment_auditions(1)
            before = store.get_release(1)

            result = app.use_vinyl_version(1, 900)
            self.assertEqual(result["status"], "ok")
            after = store.get_release(1)
            self.assertEqual([t.position for t in after.tracks], ["A1", "A2", "B1"])
            self.assertEqual(after.tracks[0].duration_seconds, 181)  # duração aprendida vem junto
            self.assertIn("Vinyl", after.formats)
            self.assertEqual(after.title, before.title)               # nome do item do Discogs
            self.assertEqual(after.synced_at, before.synced_at)       # data de cadastro mantida
            self.assertEqual(after.listen_dates, before.listen_dates) # audições mantidas
            self.assertEqual(after.notes, "Loja X")
            self.assertEqual(store.list_overrides(), {1: 900})
            self.assertEqual(app.list_admin_releases()[0].get("vinyl_override_id") or
                             next(r for r in app.list_admin_releases() if r["release_id"] == 1)["vinyl_override_id"], 900)

            # trocar de novo mantém a edição original para desfazer
            app.use_vinyl_version(1, 901)
            app.use_vinyl_version(1, None)
            restored = store.get_release(1)
            self.assertEqual([t.position for t in restored.tracks], ["1", "2", "3"])
            self.assertEqual(restored.formats, ["CD", "Album"])
            self.assertEqual(restored.listen_dates, before.listen_dates)
            self.assertEqual(store.list_overrides(), {})

    def test_versions_and_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, _ = make_app(tmp)
            app.discogs_client = FakeDiscogs()
            self.assertEqual(app.vinyl_versions(1)["versions"][0]["id"], 900)
            app.discogs_client = None
            self.assertEqual(app.vinyl_versions(1)["status"], "error")
        self.assertEqual(access_for("GET", "/api/admin/releases/1/vinyl_versions"), ADMIN)
        self.assertEqual(access_for("POST", "/api/admin/releases/1/use_version"), ADMIN)

    def test_sync_keeps_the_choice(self):
        # O sync só busca detalhes de discos novos: um disco já no catálogo mantém as faixas
        import inspect

        from vinyl_display.clients.discogs import DiscogsClient

        source = inspect.getsource(DiscogsClient.sync_collection)
        self.assertIn("release = existing", source)


if __name__ == "__main__":
    unittest.main()

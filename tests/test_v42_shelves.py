import tempfile
import unittest

from tests.test_v36_compilations_devices import make_app
from vinyl_display.routes import ADMIN, access_for


class ShelfTests(unittest.TestCase):
    def test_default_shelves_and_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            shelves = store.list_shelves()
            self.assertEqual([s["name"] for s in shelves], ["Festa", "Domingo de manhã", "Emprestados"])
            lent = shelves[2]["id"]
            store.set_shelf_item(lent, 1, True, note="com o Bruno")
            store.set_shelf_item(lent, 2, True)
            items = {i["release_id"]: i for i in store.list_shelves()[2]["items"]}
            self.assertEqual(items[1]["note"], "com o Bruno")
            store.set_shelf_item(lent, 1, True)  # sem nota: mantém a anterior
            self.assertEqual({i["release_id"]: i for i in store.list_shelves()[2]["items"]}[1]["note"], "com o Bruno")
            store.set_shelf_item(lent, 1, False)
            self.assertEqual([i["release_id"] for i in store.list_shelves()[2]["items"]], [2])

    def test_deleted_defaults_do_not_come_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, store = make_app(tmp)
            for shelf in store.list_shelves():
                store.delete_shelf(shelf["id"])
            self.assertEqual(store.list_shelves(), [])
            new_id = store.create_shelf("Para a vitrola nova", "🆕")
            store.update_shelf(new_id, name="Vitrola nova")
            self.assertEqual(store.list_shelves()[0]["name"], "Vitrola nova")
            with self.assertRaises(ValueError):
                store.create_shelf("  ")
            with self.assertRaises(ValueError):
                store.set_shelf_item(999, 1, True)

    def test_routes_are_admin(self):
        self.assertEqual(access_for("GET", "/api/admin/shelves"), ADMIN)
        for action in ("create", "update", "delete", "item"):
            self.assertEqual(access_for("POST", f"/api/admin/shelves/{action}"), ADMIN)


if __name__ == "__main__":
    unittest.main()

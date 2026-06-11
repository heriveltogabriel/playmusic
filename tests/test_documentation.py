import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DocumentationTests(unittest.TestCase):
    def test_env_example_documents_required_values(self):
        env = (ROOT / ".env.example").read_text()

        self.assertIn("RAPIDAPI_SHAZAM_KEY=", env)
        self.assertIn("DISCOGS_USER=heriveltogabriel", env)
        self.assertIn("VINYL_CERT_FILE=", env)
        self.assertIn("VINYL_KEY_FILE=", env)

    def test_readme_includes_run_and_sync_commands(self):
        readme = (ROOT / "README.md").read_text()

        self.assertIn("python3 -m vinyl_display.server", readme)
        self.assertIn("python -m vinyl_display.server", readme)
        self.assertIn("POST /api/sync", readme)
        self.assertIn("https://", readme)


if __name__ == "__main__":
    unittest.main()

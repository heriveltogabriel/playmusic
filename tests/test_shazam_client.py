import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from vinyl_display.clients.shazam import ShazamClient


class ShazamClientTests(unittest.TestCase):
    @patch("urllib.request.urlopen")
    def test_recognize_success(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(
            {
                "track": {
                    "title": "Come Together",
                    "subtitle": "The Beatles",
                    "sections": [
                        {
                            "type": "SONG",
                            "metadata": [{"title": "Album", "text": "Abbey Road"}],
                        }
                    ],
                }
            }
        ).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        client = ShazamClient(api_key="fake-key")
        result = client.recognize(b"pcm-data")

        self.assertIsNotNone(result)
        self.assertEqual(result.title, "Come Together")
        self.assertEqual(result.artist, "The Beatles")
        self.assertEqual(result.album, "Abbey Road")
        self.assertEqual(result.provider, "shazam")

    @patch("urllib.request.urlopen")
    def test_recognize_no_match(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({}).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_response

        client = ShazamClient(api_key="fake-key")
        result = client.recognize(b"pcm-data")

        self.assertIsNone(result)

    @patch("urllib.request.urlopen")
    def test_recognize_http_error(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://test",
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=None,
        )

        client = ShazamClient(api_key="fake-key")
        with self.assertRaises(RuntimeError) as context:
            client.recognize(b"pcm-data")

        self.assertIn("Shazam HTTP error 401", str(context.exception))


if __name__ == "__main__":
    unittest.main()

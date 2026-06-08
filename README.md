# Vinyl Display

Minimalist vinyl now-playing display for a Raspberry Pi server and an Android phone.

## What It Does

- Syncs the public Discogs collection for `heriveltogabriel`.
- Serves a local PWA for the OnePlus 5.
- Captures short microphone clips from the browser.
- Sends clips to AudD for recognition.
- Matches recognized tracks only against the local Discogs catalog.
- Shows a not-found message when the record is not in the collection.

## Configuration

Copy `.env.example` values into your shell environment before running the server.

Required for recognition:

```bash
export AUDD_API_TOKEN="your-token"
```

Required for Android microphone capture in Chrome:

```bash
export VINYL_CERT_FILE="/path/to/local-cert.pem"
export VINYL_KEY_FILE="/path/to/local-key.pem"
```

The browser microphone API requires a secure context. On the Raspberry Pi, run this app through HTTPS using a local certificate that the Android device trusts.

## Run

```bash
python3 -m vinyl_display.server
```

If your Raspberry Pi maps `python` to Python 3, `python -m vinyl_display.server` also works.

Open the Android phone at:

```text
https://raspberrypi.local:8080
```

## Sync Collection

The server exposes:

```text
POST /api/sync
```

From another machine on the same network:

```bash
curl -X POST https://raspberrypi.local:8080/api/sync
```

## Useful API Endpoints

```text
GET  /api/health
GET  /api/state
POST /api/sync
POST /api/recognize
```

## Tests

```bash
python3 -m unittest discover -v
```

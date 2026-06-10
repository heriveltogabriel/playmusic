# Vinyl Display

Minimalist vinyl now-playing display for a Raspberry Pi server and an Android/iOS phone.

## What It Does

- **Syncs Discogs Collection**: Local catalog mirroring for fast offline matches.
- **Design Retrô Bauhaus (Amber Landscape)**: AMOLED-friendly charcoal, warm cream, and rust-amber colors with a spinning and sliding vinyl disc animation, optimized for landscape mobile viewports.
- **Dynamic iOS Microphone Access**: Initiates the microphone and Web Audio `AudioContext` securely within user touch/click handlers to bypass iOS Safari autoplay and silent capture restrictions.
- **Real-Time PCM Resampling**: Performs client-side linear resampling to convert native device sample rates (e.g. 48kHz) to 44.1kHz mono 16-bit signed PCM on the fly for Shazam Core recognition.
- **Time-Based Scheduled Listening (Cooldown)**: Suspends microphone capture during track playback, scheduling the next query only near the end of the current song to save API credits and CPU.
- **Smooth Real-Time Progress Bar**: Interpolates progress locally at 250ms ticks for fluid animations and updates current/total times in `M:SS` format.
- **AMOLED Glassmorphism Error Popups**: Captures network, server (500), and microphone block failures, presenting a custom warning dialog instead of failing silently.
- **PWA Integration**: Includes a web manifest (`manifest.json`) for installing the app as a standalone web application on Android/iOS home screens.

## Configuration

Copy `.env.example` to `.env` and fill in your local values. The `.env` file is
ignored by git so secrets stay local.

Required for recognition (either AudD or Shazam via RapidAPI):

```env
# Option 1: AudD
AUDD_API_TOKEN=your-token

# Option 2: Shazam (via RapidAPI)
RAPIDAPI_SHAZAM_KEY=your-rapidapi-key
RAPIDAPI_SHAZAM_HOST=shazam-core.p.rapidapi.com
```

Shell environment values still take priority over `.env`, which is useful for
temporary overrides.

Required for Android microphone capture in Chrome:

```bash
export VINYL_CERT_FILE="/path/to/local-cert.pem"
export VINYL_KEY_FILE="/path/to/local-key.pem"
```

The browser microphone API requires a secure context. On the Raspberry Pi, run this app through HTTPS using a local certificate that the Android device trusts.

## Quick Installation on Raspberry Pi

We provide an automated setup script that installs required system dependencies, generates local self-signed SSL/TLS certificates, copies configuration files, and sets up a `systemd` service so that the app starts automatically when your Raspberry Pi boots.

To run the setup:

```bash
chmod +x setup_pi.sh
./setup_pi.sh
```

Once completed, fill in your API keys in the generated `.env` file and restart the service:

```bash
sudo systemctl restart vinyl-display
```

## Run Manually

If you prefer to run the server manually without `systemd`:

```bash
python3 -m vinyl_display.server
```

If your Raspberry Pi maps `python` to Python 3, `python -m vinyl_display.server` also works.

Open the browser at:

```text
https://<raspberry-pi-ip-or-host>:8080
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

#!/usr/bin/env python3
import sqlite3
import json
import urllib.request
import time
from pathlib import Path
from urllib.error import HTTPError

DB_PATH = Path("data/vinyl_display.sqlite3")
USER_AGENT = "VinylDisplayMVP/0.1 +https://localhost"

def request_json(url):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", USER_AGENT)
    while True:
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            if e.code == 429:
                print("Rate limited! Sleeping 60s...")
                time.sleep(60)
                continue
            raise

def main():
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    rows = cursor.execute("SELECT release_id, title, artist, year, payload_json FROM releases").fetchall()
    print(f"Processing {len(rows)} releases to find original release years...")

    updated_count = 0

    for idx, row in enumerate(rows):
        rid = row["release_id"]
        title = row["title"]
        artist = row["artist"]
        current_year = row["year"]
        payload_str = row["payload_json"]

        if rid < 0:
            continue

        print(f"[{idx+1}/{len(rows)}] Checking {artist} - {title} (ID: {rid})...")
        try:
            url = f"https://api.discogs.com/releases/{rid}"
            release_data = request_json(url)
            time.sleep(1.0)

            master_id = release_data.get("master_id")
            if not master_id:
                print(f"  No master release found. Keeping year {current_year}.")
                continue

            master_url = f"https://api.discogs.com/masters/{master_id}"
            master_data = request_json(master_url)
            time.sleep(1.0)

            original_year = master_data.get("year")
            if original_year and int(original_year) != current_year:
                print(f"  Updating year from {current_year} to {original_year}!")
                
                payload = json.loads(payload_str)
                payload["year"] = int(original_year)
                new_payload_str = json.dumps(payload, ensure_ascii=False, sort_keys=True)

                cursor.execute(
                    "UPDATE releases SET year = ?, payload_json = ? WHERE release_id = ?",
                    (int(original_year), new_payload_str, rid)
                )
                conn.commit()
                updated_count += 1
            else:
                print(f"  Year is already correct or not found ({original_year}).")

        except Exception as e:
            print(f"  Error processing release {rid}: {e}")
            time.sleep(2.0)

    conn.close()
    print(f"\nMigration finished. Updated {updated_count} releases with original year.")

if __name__ == "__main__":
    main()

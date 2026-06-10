#!/usr/bin/env python3
import sqlite3
import json
import urllib.request
import datetime
from pathlib import Path

# Paths
DB_PATH = Path("data/vinyl_display.sqlite3")
BACKUP_JSON_PATH = Path("scratch/catalogolp/collection.json")

def parse_iso_date(date_str: str) -> float:
    val = date_str.replace('Z', '+00:00')
    dt = datetime.datetime.fromisoformat(val)
    return dt.timestamp()

def fetch_live_collection() -> dict[int, str]:
    print("Fetching live collection metadata from Discogs API...")
    releases = {}
    page = 1
    user_agent = "VinylDisplayMVP/0.1 +https://localhost"
    while True:
        url = f"https://api.discogs.com/users/heriveltogabriel/collection/folders/0/releases?per_page=100&page={page}"
        req = urllib.request.Request(url)
        req.add_header("User-Agent", user_agent)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"Error fetching page {page} from Discogs API: {e}")
            break
        
        items = data.get("releases", [])
        for item in items:
            rid = int(item["id"])
            date_added = item.get("date_added")
            if date_added:
                releases[rid] = date_added
        
        pagination = data.get("pagination", {})
        if int(pagination.get("page", page)) >= int(pagination.get("pages", page)):
            break
        page += 1
    return releases

def load_backup_collection() -> dict[int, str]:
    if not BACKUP_JSON_PATH.exists():
        print("Backup collection.json not found.")
        return {}
    print(f"Loading backup collection metadata from {BACKUP_JSON_PATH}...")
    try:
        with open(BACKUP_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {int(r["id"]): r["date_added"] for r in data if "id" in r and "date_added" in r}
    except Exception as e:
        print(f"Error reading backup collection: {e}")
        return {}

def main():
    if not DB_PATH.exists():
        print(f"Database not found at: {DB_PATH}")
        return

    # Load mapping
    live_map = fetch_live_collection()
    backup_map = load_backup_collection()
    
    # Consolidate mapping
    mapping = {}
    mapping.update(backup_map)
    mapping.update(live_map)  # Live overrides backup
    
    print(f"Consolidated date mapping for {len(mapping)} releases.")
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all releases
    rows = cursor.execute("SELECT release_id, title, artist, payload_json, synced_at FROM releases").fetchall()
    
    updated_count = 0
    skipped_count = 0
    
    for row in rows:
        rid = row["release_id"]
        title = row["title"]
        artist = row["artist"]
        payload_json_str = row["payload_json"]
        current_synced = row["synced_at"]
        
        date_str = mapping.get(rid)
        if not date_str:
            print(f"⚠️ No date found in mapping for release {rid} - {artist} - {title}. Skipping.")
            skipped_count += 1
            continue
            
        try:
            ts = parse_iso_date(date_str)
        except Exception as e:
            print(f"❌ Error parsing date '{date_str}' for release {rid}: {e}. Skipping.")
            skipped_count += 1
            continue
            
        # Update payload_json
        try:
            payload = json.loads(payload_json_str)
            payload["synced_at"] = ts
            new_payload_json_str = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        except Exception as e:
            print(f"❌ Error updating payload_json for release {rid}: {e}. Skipping.")
            skipped_count += 1
            continue
            
        # Check if values actually changed
        if abs(current_synced - ts) > 0.001 or payload_json_str != new_payload_json_str:
            cursor.execute(
                "UPDATE releases SET synced_at = ?, payload_json = ? WHERE release_id = ?",
                (ts, new_payload_json_str, rid)
            )
            updated_count += 1
            
    conn.commit()
    conn.close()
    
    print(f"\nMigration complete:")
    print(f"  Total db releases processed: {len(rows)}")
    print(f"  Successfully updated: {updated_count}")
    print(f"  Skipped/unmodified: {len(rows) - updated_count - skipped_count}")
    print(f"  Errors/Missing: {skipped_count}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Script to synchronize private notes from Discogs collection to the local/remote SQLite database.
Fetches collection metadata with pagination and updates payload_json['notes'] for each release.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from vinyl_display.config import load_config


def fetch_discogs_notes(username: str, token: str, user_agent: str) -> dict[int, str]:
    headers = {
        "User-Agent": user_agent,
        "Authorization": f"Discogs token={token}",
    }
    
    notes_by_id: dict[int, str] = {}
    page = 1
    
    print(f"[DISCOGS] Conectando à API do Discogs para o usuário '{username}'...")
    while True:
        url = f"https://api.discogs.com/users/{username}/collection/folders/0/releases?per_page=100&page={page}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[ERRO] Falha ao consultar página {page}: {e}")
            break
            
        releases = data.get("releases", [])
        for r in releases:
            rid = int(r["id"])
            notes_list = r.get("notes") or []
            note_val = ""
            # Priority: field_id == 3 (Notes field in Discogs)
            for n in notes_list:
                if n.get("field_id") == 3 and n.get("value"):
                    note_val = str(n.get("value", "")).strip()
                    break
            if not note_val:
                for n in notes_list:
                    if n.get("value"):
                        note_val = str(n.get("value", "")).strip()
                        break
            notes_by_id[rid] = note_val

        pagination = data.get("pagination", {})
        total_pages = pagination.get("pages", 1)
        total_items = pagination.get("items", len(notes_by_id))
        print(f"  -> Página {page}/{total_pages} processada ({len(releases)} discos nesta página, total {total_items} no Discogs)")
        
        if page >= total_pages:
            break
        page += 1
        time.sleep(1.0)
        
    non_empty = sum(1 for v in notes_by_id.values() if v)
    print(f"[DISCOGS] Total de {len(notes_by_id)} discos mapeados. {non_empty} possuem notas privadas.")
    return notes_by_id


def update_database_notes(db_path: str, notes_by_id: dict[int, str]) -> tuple[int, int]:
    print(f"[DB] Abrindo banco de dados: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    rows = cursor.execute("SELECT release_id, title, artist, payload_json FROM releases").fetchall()
    print(f"[DB] Total de lançamentos no banco de dados: {len(rows)}")
    
    updated_count = 0
    samples: list[str] = []
    
    for row in rows:
        rid = row["release_id"]
        if rid in notes_by_id:
            new_note = notes_by_id[rid]
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                payload = {}
                
            old_note = payload.get("notes", "")
            if old_note != new_note:
                payload["notes"] = new_note
                new_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
                cursor.execute(
                    "UPDATE releases SET payload_json = ? WHERE release_id = ?",
                    (new_json, rid),
                )
                updated_count += 1
                if len(samples) < 5 and new_note:
                    samples.append(f"  • [{rid}] {row['artist']} - {row['title']}: \"{new_note}\"")
                    
    conn.commit()
    conn.close()
    
    print(f"[DB] Atualizados {updated_count} lançamentos com sucesso!")
    if samples:
        print("[DB] Exemplos de notas sincronizadas:")
        for s in samples:
            print(s)
            
    return len(rows), updated_count


def main():
    parser = argparse.ArgumentParser(description="Sincronizar notas do Discogs com o banco de dados SQLite.")
    parser.add_argument("--db", type=str, default=None, help="Caminho para o banco sqlite3")
    args = parser.parse_args()
    
    config = load_config()
    db_path = args.db or str(config.database_path)
    
    notes_by_id = fetch_discogs_notes(
        username=config.discogs_user,
        token=config.discogs_token,
        user_agent=config.discogs_user_agent,
    )
    
    update_database_notes(db_path, notes_by_id)


if __name__ == "__main__":
    main()

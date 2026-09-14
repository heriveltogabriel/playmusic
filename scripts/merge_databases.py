import shutil
import sqlite3
import json
import time
from pathlib import Path

def get_stats(conn, release_id):
    row = conn.execute("SELECT rating, auditions FROM release_stats WHERE release_id = ?", (release_id,)).fetchone()
    if row:
        return row[0], row[1]
    return 0, 0

def main():
    local_db_path = Path("data/vinyl_display.sqlite3")
    remote_db_path = Path("data/vinyl_display_remote.sqlite3")
    backup_db_path = Path("data/vinyl_display_local_backup.sqlite3")
    
    if not local_db_path.exists():
        print("Erro: Banco de dados local não encontrado em:", local_db_path)
        return
        
    if not remote_db_path.exists():
        print("Erro: Banco de dados remoto não encontrado em:", remote_db_path)
        return
        
    print(f"📦 Criando backup do banco de dados local em: {backup_db_path}")
    shutil.copyfile(local_db_path, backup_db_path)
    
    local_conn = sqlite3.connect(local_db_path)
    local_conn.row_factory = sqlite3.Row
    
    remote_conn = sqlite3.connect(remote_db_path)
    remote_conn.row_factory = sqlite3.Row
    
    # Load all local releases
    local_rows = local_conn.execute("SELECT release_id, title, artist, year, cover_url, payload_json, synced_at FROM releases").fetchall()
    local_releases = {row["release_id"]: dict(row) for row in local_rows}
    
    # Load all remote releases
    remote_rows = remote_conn.execute("SELECT release_id, title, artist, year, cover_url, payload_json, synced_at FROM releases").fetchall()
    remote_releases = {row["release_id"]: dict(row) for row in remote_rows}
    
    print(f"Lidos {len(local_releases)} discos locais e {len(remote_releases)} discos remotos.")
    
    merged_count = 0
    imported_count = 0
    
    for r_id, remote_rel in remote_releases.items():
        remote_payload = json.loads(remote_rel["payload_json"])
        remote_rating, remote_auditions = get_stats(remote_conn, r_id)
        
        # If release is in both databases, merge them
        if r_id in local_releases:
            local_rel = local_releases[r_id]
            local_payload = json.loads(local_rel["payload_json"])
            local_rating, local_auditions = get_stats(local_conn, r_id)
            
            # 1. Merge listen_dates (set union, sorted)
            local_dates = local_payload.get("listen_dates", []) or []
            remote_dates = remote_payload.get("listen_dates", []) or []
            merged_dates = sorted(list(set(local_dates) | set(remote_dates)))
            
            # 2. Merge auditions (play count)
            merged_auditions = len(merged_dates)
            
            # 3. Merge rating (take max)
            merged_rating = max(local_rating, remote_rating, local_payload.get("rating", 0), remote_payload.get("rating", 0))
            
            # 4. Merge favorite status
            merged_favorite = bool(local_payload.get("favorite", False) or remote_payload.get("favorite", False) or (merged_auditions >= 20))
            
            # 5. Merge synced_at (take oldest/minimum)
            local_sync = float(local_rel["synced_at"] or local_payload.get("synced_at", 0.0))
            remote_sync = float(remote_rel["synced_at"] or remote_payload.get("synced_at", 0.0))
            if local_sync > 0.0 and remote_sync > 0.0:
                merged_sync = min(local_sync, remote_sync)
            else:
                merged_sync = local_sync or remote_sync or time.time()
                
            # 6. Merge notes
            local_notes = (local_payload.get("notes") or "").strip()
            remote_notes = (remote_payload.get("notes") or "").strip()
            if local_notes and remote_notes and local_notes != remote_notes:
                merged_notes = f"{local_notes}\n\n[Nota Importada do Servidor]:\n{remote_notes}"
            else:
                merged_notes = local_notes or remote_notes
                
            # Update local payload dict
            merged_payload = local_payload.copy()
            merged_payload.update({
                "listen_dates": merged_dates,
                "auditions": merged_auditions,
                "rating": merged_rating,
                "favorite": merged_favorite,
                "synced_at": merged_sync,
                "notes": merged_notes,
                # Retain original/edition years if present in either
                "original_year": local_payload.get("original_year") or remote_payload.get("original_year") or local_payload.get("year"),
                "edition_year": local_payload.get("edition_year") or remote_payload.get("edition_year") or local_payload.get("year"),
            })
            
            # Also preserve year on the outer releases table row
            merged_year = local_rel["year"] or remote_rel["year"] or merged_payload.get("original_year")
            
            # Save merged back to local db
            local_conn.execute(
                """
                UPDATE releases 
                SET payload_json = ?, year = ?, synced_at = ?
                WHERE release_id = ?
                """,
                (json.dumps(merged_payload, ensure_ascii=False, sort_keys=True), merged_year, merged_sync, r_id)
            )
            
            # Update release_stats
            local_conn.execute(
                """
                INSERT INTO release_stats (release_id, rating, auditions)
                VALUES (?, ?, ?)
                ON CONFLICT(release_id) DO UPDATE SET
                    rating = excluded.rating,
                    auditions = excluded.auditions
                """,
                (r_id, merged_rating, merged_auditions)
            )
            
            merged_count += 1
            
        else:
            # If release is only in remote database, import it completely
            local_conn.execute(
                """
                INSERT INTO releases (release_id, title, artist, year, cover_url, payload_json, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r_id,
                    remote_rel["title"],
                    remote_rel["artist"],
                    remote_rel["year"],
                    remote_rel["cover_url"],
                    remote_rel["payload_json"],
                    remote_rel["synced_at"]
                )
            )
            
            local_conn.execute(
                """
                INSERT INTO release_stats (release_id, rating, auditions)
                VALUES (?, ?, ?)
                """,
                (r_id, remote_rating, remote_auditions)
            )
            
            imported_count += 1
            
    local_conn.commit()
    local_conn.close()
    remote_conn.close()
    
    print(f"\n✅ Mesclagem concluída!")
    print(f"   - Discos mesclados (existentes em ambos): {merged_count}")
    print(f"   - Discos importados (existentes apenas no remoto): {imported_count}")
    print(f"O banco de dados local '{local_db_path}' foi atualizado com sucesso.")

if __name__ == "__main__":
    main()

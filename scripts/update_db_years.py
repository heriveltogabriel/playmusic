import sys
import time
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from vinyl_display.config import load_config
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import DiscogsClient

def main():
    config = load_config()
    store = CatalogStore(config.database_path)
    store.initialize()
    
    client = DiscogsClient(
        username=config.discogs_user,
        user_agent=config.discogs_user_agent,
        api_base="https://api.discogs.com"
    )
    if config.discogs_token:
        client.headers["Authorization"] = f"Discogs token={config.discogs_token}"
        
    releases = store.list_releases()
    discogs_releases = [r for r in releases if r.release_id > 0]
    total = len(discogs_releases)
    print(f"Encontrados {total} discos do Discogs para atualizar no banco de dados...")
    
    updated_count = 0
    error_count = 0
    
    for idx, release in enumerate(discogs_releases, 1):
        print(f"[{idx}/{total}] Atualizando '{release.title}' (ID: {release.release_id})...", end="", flush=True)
        try:
            # Fetch details (will resolve master_id to get original_year and edition_year)
            updated_release = client.release_details(release.release_id)
            
            # Save it back to store
            store.upsert_release(updated_release)
            
            print(f" OK! Original: {updated_release.original_year}, Edição: {updated_release.edition_year}")
            updated_count += 1
            
            # Respect rate limit: 1-2 seconds delay
            time.sleep(1.2)
        except Exception as e:
            print(f" ERRO: {e}")
            error_count += 1
            time.sleep(2.0)
            
    print(f"\nMigração concluída! Atualizados: {updated_count}, Erros: {error_count}")

if __name__ == "__main__":
    main()

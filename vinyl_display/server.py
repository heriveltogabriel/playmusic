from __future__ import annotations

import json
import mimetypes
import ssl
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs as _parse_qs, quote, urlparse

from vinyl_display.app import VinylDisplayApp
from vinyl_display.catalog import CatalogStore
from vinyl_display.clients.discogs import DiscogsClient
from vinyl_display.config import Config, load_config
from vinyl_display.auth import AuthManager
from vinyl_display.routes import ADMIN, DEVICE, access_for
from vinyl_display.limite import LimiteTentativas, texto_espera

LIMITE_SENHA = LimiteTentativas()


def build_app(config: Config) -> VinylDisplayApp:
    store = CatalogStore(config.database_path)
    discogs = DiscogsClient(
        config.discogs_user, config.discogs_user_agent, token=config.discogs_token
    )
    recognizer = VinylDisplayApp.make_shazam_client(store, config)
    print(f"[SERVER] Using Shazam (via RapidAPI) with {len(recognizer.api_keys)} key(s), daily budget {recognizer.daily_budget}.")
    return VinylDisplayApp(store, discogs, recognizer, config)



class VinylRequestHandler(SimpleHTTPRequestHandler):
    app: VinylDisplayApp
    static_dir: Path
    auth: AuthManager

    DEVICE_COOKIE = "vinyl_device"

    def _get_cookie(self, name: str) -> str | None:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return None
        return cookie[name].value if name in cookie else None

    def _device_allowed(self) -> bool:
        """Player e Ouvir: liberados se a exigência estiver desligada, se houver login do
        admin ou se este aparelho foi autorizado em Configurações."""
        if not getattr(self.app.config, "require_device_token", False):
            return True
        if self._is_authenticated():
            return True
        return self.auth.validate_device(self._get_cookie(self.DEVICE_COOKIE)) is not None

    def _send_device_required(self) -> None:
        body = json.dumps(
            {
                "error": "device_not_authorized",
                "message": "Este aparelho não está autorizado. Abra /admin nele, faça login e toque em "
                "\"Autorizar este aparelho\" em Configurações.",
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get_session_token(self) -> str | None:
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return None
        if "session_token" in cookie:
            return cookie["session_token"].value
        return None

    def _secure_flag(self) -> str:
        """Marca o cookie como Secure quando a requisição chegou por HTTPS (nginx ou TLS próprio)."""
        forwarded = (self.headers.get("X-Forwarded-Proto") or "").lower()
        if forwarded == "https" or isinstance(self.connection, ssl.SSLSocket):
            return "; Secure"
        return ""

    def _is_authenticated(self) -> bool:
        token = self._get_session_token()
        if not token:
            return False
        return self.auth.validate_session(token)

    def _send_unauthorized(self) -> None:
        body = json.dumps({"error": "Não autorizado. Faça login novamente."}, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _site_fechado(self) -> bool:
        return bool(getattr(self.app.config, "site_fechado", False))

    def _ip(self) -> str:
        """IP de quem chamou. Atrás do nginx (conexão local) vale o X-Real-IP que ele manda."""
        remoto = self.client_address[0] if self.client_address else ""
        if remoto in ("127.0.0.1", "::1"):
            return (self.headers.get("X-Real-IP") or remoto).strip()
        return remoto

    @staticmethod
    def _destino_seguro(destino: str | None, padrao: str = "/") -> str:
        """Só caminhos do próprio site (evita mandar alguém para outro domínio depois do login)."""
        if destino and destino.startswith("/") and not destino.startswith("//") and "\\" not in destino:
            return destino
        return padrao

    def _redirect(self, destino: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", destino)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _redirect_login(self, path: str) -> None:
        """Página pedida sem login: vai para a tela de login e volta para ela depois."""
        prefixo = (self.headers.get("X-Forwarded-Prefix") or "").rstrip("/")
        pedido = "/" if path == "/herivelto" else prefixo + path
        query = urlparse(self.path).query
        if query:
            pedido += "?" + query
        self._redirect("/login?next=" + quote(pedido, safe="/"))

    def _check_access(self, method: str, path: str) -> bool:
        """Aplica a tabela de acesso de vinyl_display/routes.py. Responde 401 (ou manda para a
        tela de login, no caso de uma página com o site fechado) e devolve False quando o
        pedido não pode seguir."""
        fechado = self._site_fechado()
        level = access_for(method, path, fechado)
        pagina = fechado and method == "GET" and not path.startswith(("/api/", "/static/"))
        if level == ADMIN and not self._is_authenticated():
            if pagina:
                self._redirect_login(path)
            else:
                self._send_unauthorized()
            return False
        if level == DEVICE:
            if fechado:
                liberado = self._is_authenticated() or (
                    self.auth.validate_device(self._get_cookie(self.DEVICE_COOKIE)) is not None
                )
            else:
                liberado = self._device_allowed()
            if not liberado:
                if pagina:
                    self._redirect_login(path)
                else:
                    self._send_device_required()
                return False
        return True

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        
        if not self._check_access("GET", path):
            return

        if path == "/api/health":
            self._json({"status": "ok"})
            return
        if path == "/api/state":
            self._json(self.app.state())
            return
        if path == "/api/config":
            version_str = "1.0.0"
            try:
                version_path = Path(__file__).parent.parent / "version.txt"
                if version_path.exists():
                    version_str = version_path.read_text(encoding="utf-8").strip()
            except Exception:
                pass
            config_data = {
                "version": version_str,
                "discogs_user": self.app.config.discogs_user if self.app.config else "",
                "discogs_user_agent": self.app.config.discogs_user_agent if self.app.config else "",
                "discogs_token": self.app.config.discogs_token if self.app.config else "",
                "rapidapi_shazam_key": self.app.config.rapidapi_shazam_key if self.app.config else "",
                "rapidapi_shazam_host": self.app.config.rapidapi_shazam_host if self.app.config else "",
                "last_sync_at": self.app.store.get_metadata("discogs_last_sync_at"),
                "last_sync_count": self.app.store.get_metadata("discogs_last_sync_count"),
                "last_sync_added": self.app.store.get_metadata("discogs_last_sync_added"),
                "last_sync_updated": self.app.store.get_metadata("discogs_last_sync_updated"),
                "last_sync_deleted": self.app.store.get_metadata("discogs_last_sync_deleted"),
                "last_sync_error": self.app.store.get_metadata("discogs_last_sync_error") or "",
                "lyrics_latency_offset": self.app.config.lyrics_latency_offset if self.app.config else 1.3,
                "favorite_threshold": self.app.config.favorite_threshold if self.app.config else 5,
                "collection_name": getattr(self.app.config, "collection_name", "") if self.app.config else "",
                "shazam_daily_budget": getattr(self.app.config, "shazam_daily_budget", 0) if self.app.config else 0,
                "telegram_bot_token": getattr(self.app.config, "telegram_bot_token", "") if self.app.config else "",
                "telegram_chat_id": getattr(self.app.config, "telegram_chat_id", "") if self.app.config else "",
                "ntfy_topic": getattr(self.app.config, "ntfy_topic", "") if self.app.config else "",
                "alert_quiet_start": getattr(self.app.config, "alert_quiet_start", "") if self.app.config else "",
                "alert_quiet_end": getattr(self.app.config, "alert_quiet_end", "") if self.app.config else "",
                "shazam_usage": self.app.shazam_usage(),
            }
            self._json(config_data)
            return
        if path == "/":
            self._send_static("index.html")
            return
        if path == "/login" or path == "/login/":
            if self._is_authenticated():
                destino = _parse_qs(urlparse(self.path).query).get("next", [""])[0]
                self._redirect(self._destino_seguro(destino))
            else:
                self._send_static("login.html")
            return
        if path == "/admin" or path == "/admin/":
            if not self._is_authenticated():
                self._send_static("login.html")
            else:
                self._send_static("admin.html")
            return
        if path == "/ouvir" or path == "/ouvir/":
            self._send_static("ouvir.html")
            return
        if path == "/gravar" or path == "/gravar/":
            self._send_static("gravar.html")
            return
        if path == "/agenda" or path == "/agenda/":
            self._send_static("agenda.html")
            return
        if path == "/herivelto" or path == "/herivelto/":
            self._send_static("herivelto.html")
            return
        if path in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"):
            self._send_static("playvinil-icon-180.png")
            return
        if path == "/favicon.ico":
            self._send_static("playvinil-favicon.png")
            return
        if path == "/api/ouvir/releases":
            releases = self.app.list_admin_releases()
            clean_data = [
                {
                    "id": r.get("release_id"),
                    "title": r.get("title"),
                    "artist": r.get("artist"),
                    "year": r.get("year"),
                    "cover_url": r.get("cover_url"),
                    "label": (r.get("labels") or [""])[0],
                    "plays": r.get("auditions", 0),
                    "synced_at": r.get("synced_at") or 0.0
                }
                for r in releases
            ]
            self._json(clean_data)
            return

        if path == "/api/admin/historical_agendas":
            hist_str = self.app.store.get_metadata("historical_agendas")
            historical = {}
            if hist_str:
                try:
                    historical = json.loads(hist_str)
                except:
                    pass
            self._json(historical)
            return

        if path == "/api/ouvir/agenda":
            agenda_releases = self.app.get_weekly_agenda()
            clean_data = [
                {
                    "id": r.get("release_id"),
                    "title": r.get("title"),
                    "artist": r.get("artist"),
                    "year": r.get("year"),
                    "cover_url": r.get("cover_url"),
                    "plays": r.get("auditions", 0),
                    "synced_at": r.get("synced_at") or 0.0
                }
                for r in agenda_releases
            ]
            self._json(clean_data)
            return
        if path.startswith("/api/ouvir/sides/"):
            try:
                release_id = int(path.rsplit("/", 1)[-1])
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            sides = self.app.release_sides(release_id)
            if sides is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._json(sides)
            return
        if path == "/api/ouvir/history":
            history = self.app.get_listening_history()
            self._json(history)
            return
        if path == "/api/admin/recognition":
            from urllib.parse import parse_qs
            import time as _time

            days = parse_qs(urlparse(self.path).query).get("days", ["30"])[0]
            try:
                days_value = max(1, min(365, int(days)))
            except ValueError:
                days_value = 30
            report = self.app.store.recognition_report(since=_time.time() - days_value * 86400)
            report["days"] = days_value
            report["shazam_usage"] = self.app.shazam_usage()
            self._json(report)
            return
        if path == "/api/admin/artist":
            from urllib.parse import parse_qs

            from vinyl_display.artist import artist_listening, discography

            query = parse_qs(urlparse(self.path).query)
            try:
                ids = [int(x) for x in (query.get("release_ids") or [""])[0].split(",") if x.strip()][:200]
            except ValueError:
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            result = {"listening": artist_listening(self.app.store, ids)}
            if (query.get("discography") or ["1"])[0] != "0":
                result["discography"] = discography(self.app, ids, refresh=(query.get("refresh") or ["0"])[0] == "1")
            self._json(result)
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/vinyl_versions"):
            try:
                release_id = int(path.split("/")[4])
            except (IndexError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            self._json(self.app.vinyl_versions(release_id))
            return
        if path == "/api/admin/system":
            from vinyl_display.system_status import build_system_status

            self._json(build_system_status(self.app))
            return
        if path == "/api/admin/shelves":
            self._json({"shelves": self.app.store.list_shelves()})
            return
        if path == "/api/admin/diary":
            from urllib.parse import parse_qs

            query = parse_qs(urlparse(self.path).query)
            try:
                days = max(1, min(365, int((query.get("days") or ["30"])[0])))
            except ValueError:
                days = 30
            self._json(self.app.diary(days))
            return
        if path == "/api/admin/care":
            self._json(self.app.care())
            return
        if path == "/api/admin/player_status":
            self._json(self.app.player_status())
            return
        if path == "/api/admin/devices":
            this_device = self.auth.validate_device(self._get_cookie(self.DEVICE_COOKIE))
            self._json(
                {
                    "require_device_token": bool(getattr(self.app.config, "require_device_token", False)),
                    "this_device": this_device["id"] if this_device else None,
                    "devices": self.auth.list_devices(),
                }
            )
            return
        if path == "/api/admin/releases":
            self._json(self.app.list_admin_releases())
            return
        if path == "/api/search":
            from urllib.parse import parse_qs, quote_plus
            import urllib.request
            from urllib.error import HTTPError
            
            query_params = parse_qs(urlparse(self.path).query)
            q = query_params.get("q", [""])[0]
            token = (
                query_params.get("token", [""])[0]
                or (self.app.config.discogs_token if self.app.config else "")
            ).strip()
            
            if not token:
                body = json.dumps({
                    "error": "Configure o token do Discogs na tela de Configurações."
                }).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
                
            discogs_url = f"https://api.discogs.com/database/search?q={quote_plus(q)}&type=release"
            req = urllib.request.Request(discogs_url)
            req.add_header("User-Agent", "VinylDisplayAdmin/1.0")
            req.add_header("Authorization", f"Discogs token={token}")
            
            try:
                with urllib.request.urlopen(req, timeout=15) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
                    self._json(res_data)
            except HTTPError as error:
                try:
                    err_body = error.read().decode("utf-8")
                    err_json = json.loads(err_body)
                    err_msg = err_json.get("message", str(error))
                except Exception:
                    err_msg = str(error)
                body = json.dumps({"error": f"Erro do Discogs: {err_msg}"}).encode("utf-8")
                self.send_response(error.code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return
        if path == "/api/admin/stats":
            releases = self.app.list_admin_releases()
            total_releases = len(releases)
            total_auditions = sum(r.get("auditions", 0) for r in releases)
            
            # Find top rated
            rated_releases = [r for r in releases if r.get("rating", 0) > 0]
            top_rated = max(rated_releases, key=lambda x: x["rating"]) if rated_releases else None
            
            # Find top listened
            listened_releases = [r for r in releases if r.get("auditions", 0) > 0]
            top_listened = max(listened_releases, key=lambda x: x["auditions"]) if listened_releases else None
            
            # Suggestion of the week: select deterministically based on year + week_number
            import datetime
            suggestion = None
            if releases:
                now = datetime.datetime.now()
                year, week_num, _ = now.isocalendar()
                seed_val = year * 100 + week_num
                import random
                sorted_releases = sorted(releases, key=lambda x: x["release_id"])
                rng = random.Random(seed_val)
                suggestion = rng.choice(sorted_releases)
                
            # Additional Aggregations
            different_artists = len(set(r.get("artist", "").strip() for r in releases if r.get("artist")))
            favorited_count = sum(1 for r in releases if r.get("favorite", False))
            average_rating = round(sum(r.get("rating", 0) for r in rated_releases) / len(rated_releases), 1) if rated_releases else 0.0
            
            # Genre Distribution
            from collections import Counter
            genres = []
            for r in releases:
                for g in r.get("genres", []):
                    if g:
                        genres.append(g)
            genre_counts = Counter(genres)
            genre_distribution = []
            for name, count in genre_counts.most_common():
                pct = round((count / total_releases) * 100) if total_releases > 0 else 0
                genre_distribution.append({
                    "name": name,
                    "count": count,
                    "percentage": pct
                })
                
            # Artist Ranking
            artists = [r.get("artist", "").strip() for r in releases if r.get("artist")]
            artist_counts = Counter(artists)
            artist_ranking = []
            for name, count in artist_counts.most_common(10):
                artist_ranking.append({
                    "name": name,
                    "count": count
                })
                
            # Last Added LPs
            sorted_by_date = sorted(
                releases,
                key=lambda x: (x.get("synced_at") or 0.0, x.get("release_id")),
                reverse=True
            )
            last_added = sorted_by_date[:10]
            
            # All Listened LPs sorted descending by audits, then alphabetically by artist/title
            top_listened_all = sorted(
                [r for r in releases if r.get("auditions", 0) > 0],
                key=lambda x: (-x.get("auditions", 0), x.get("artist", "").lower(), x.get("title", "").lower())
            )
            
            self._json({
                "total_releases": total_releases,
                "total_auditions": total_auditions,
                "top_rated": top_rated,
                "top_listened": top_listened,
                "suggestion": suggestion,
                "different_artists": different_artists,
                "favorited_count": favorited_count,
                "average_rating": average_rating,
                "genre_distribution": genre_distribution,
                "artist_ranking": artist_ranking,
                "last_added": last_added,
                "top_listened_all": top_listened_all
            })
            return
        if path.startswith("/static/"):
            self._send_static(path.removeprefix("/static/"))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        
        if not self._check_access("POST", path):
            return

        # Public authentication routes
        if path in ("/api/auth/login", "/api/auth/recover"):
            espera = LIMITE_SENHA.espera(self._ip())
            if espera:
                self._json_status(
                    {"success": False, "error": f"Muitas tentativas erradas. Tente de novo em {texto_espera(espera)}."},
                    HTTPStatus.TOO_MANY_REQUESTS,
                )
                return

        if path == "/api/auth/login":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            password = payload.get("password", "")
            
            if self.auth.verify_password(password):
                LIMITE_SENHA.acertou(self._ip())
                first_access = self.auth.is_first_access()
                if first_access:
                    self._json({"success": True, "first_access": True})
                else:
                    token = self.auth.create_session()
                    body = json.dumps({"success": True, "first_access": False}, ensure_ascii=False).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Set-Cookie", f"session_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{self._secure_flag()}")
                    self.end_headers()
                    self.wfile.write(body)
            else:
                LIMITE_SENHA.errou(self._ip())
                body = json.dumps({"success": False, "error": "Senha incorreta."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return

        if path == "/api/auth/setup":
            if not self.auth.is_first_access():
                body = json.dumps({"success": False, "error": "Acesso de configuração inicial já foi concluído."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.FORBIDDEN)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
                
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            new_password = payload.get("new_password", "")
            
            if not new_password or len(new_password) < 6:
                body = json.dumps({"success": False, "error": "A senha deve ter pelo menos 6 caracteres."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
                
            recovery_key = self.auth.setup_new_password(new_password)
            token = self.auth.create_session()
            
            body = json.dumps({"success": True, "recovery_key": recovery_key}, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", f"session_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{self._secure_flag()}")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/recover":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            recovery_key = payload.get("recovery_key", "")
            new_password = payload.get("new_password", "")
            
            if not recovery_key or not new_password or len(new_password) < 6:
                body = json.dumps({"success": False, "error": "Chave de recuperação ou nova senha inválida."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
                
            new_recovery_key = self.auth.recover_password(recovery_key, new_password)
            if new_recovery_key:
                LIMITE_SENHA.acertou(self._ip())
                token = self.auth.create_session()
                body = json.dumps({"success": True, "new_recovery_key": new_recovery_key}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Set-Cookie", f"session_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{self._secure_flag()}")
                self.end_headers()
                self.wfile.write(body)
            else:
                LIMITE_SENHA.errou(self._ip())
                body = json.dumps({"success": False, "error": "Chave de recuperação incorreta."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return

        if path == "/api/auth/logout":
            token = self._get_session_token()
            if token:
                self.auth.destroy_session(token)
            
            body = json.dumps({"success": True}, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", f"session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{self._secure_flag()}")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/change_password":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            current_password = payload.get("current_password", "")
            new_password = payload.get("new_password", "")
            
            if not current_password or not new_password or len(new_password) < 6:
                body = json.dumps({"success": False, "error": "Senha atual ou nova senha inválida."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
                
            if self.auth.verify_password(current_password):
                recovery_key = self.auth.setup_new_password(new_password)
                self._json({"success": True, "recovery_key": recovery_key})
            else:
                body = json.dumps({"success": False, "error": "Senha atual incorreta."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return

        if path == "/api/sync":
            self._json(self.app.sync_collection())
            return
        if path == "/api/config":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            payload = json.loads(body_bytes.decode("utf-8"))
            
            updates = {
                "DISCOGS_USER": payload.get("discogs_user", "").strip(),
                "DISCOGS_USER_AGENT": payload.get("discogs_user_agent", "").strip(),
                "DISCOGS_TOKEN": payload.get("discogs_token", "").strip(),
                "RAPIDAPI_SHAZAM_KEY": payload.get("rapidapi_shazam_key", "").strip(),
                "RAPIDAPI_SHAZAM_HOST": payload.get("rapidapi_shazam_host", "").strip(),
                "LYRICS_LATENCY_OFFSET": str(payload.get("lyrics_latency_offset", 1.3)).strip(),
                "FAVORITE_THRESHOLD": str(payload.get("favorite_threshold", 5)).strip(),
            }
            if "shazam_daily_budget" in payload:
                updates["SHAZAM_DAILY_BUDGET"] = str(int(payload.get("shazam_daily_budget") or 0))
            if "collection_name" in payload:
                updates["COLLECTION_NAME"] = str(payload.get("collection_name") or "").strip()[:60]
            for field, env in (("telegram_bot_token", "TELEGRAM_BOT_TOKEN"), ("telegram_chat_id", "TELEGRAM_CHAT_ID"), ("ntfy_topic", "NTFY_TOPIC"),
                               ("alert_quiet_start", "ALERT_QUIET_START"), ("alert_quiet_end", "ALERT_QUIET_END")):
                if field in payload:
                    updates[env] = str(payload.get(field) or "").strip()
            
            try:
                self.app.update_config(updates)
                self._json({"status": "ok"})
            except Exception as e:
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return
        if path == "/api/recognize":
            length = int(self.headers.get("Content-Length", "0"))
            audio_bytes = self.rfile.read(length)
            filename = self.headers.get("X-Clip-Filename", "clip.webm")
            client_elapsed_ms = self.headers.get("X-Client-Elapsed-Ms")
            elapsed_seconds = None
            if client_elapsed_ms:
                try:
                    elapsed_seconds = float(client_elapsed_ms) / 1000.0
                except ValueError:
                    pass
            trigger = (self.headers.get("X-Recognize-Reason") or "").strip().lower() or None
            self._json(self.app.recognize_audio(
                audio_bytes, filename=filename, client_elapsed_seconds=elapsed_seconds, trigger=trigger
            ))
            return
        if path == "/api/playback/next":
            self.app.playback.skip_next()
            self._json(self.app.state())
            return
        if path == "/api/playback/prev":
            self.app.playback.skip_prev()
            self._json(self.app.state())
            return
        if path in ("/api/playback/boundary", "/api/playback/flip"):
            length = int(self.headers.get("Content-Length", "0") or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
                ago = float(payload.get("ago_seconds") or 0)
                gap = payload.get("gap_seconds")
                gap = float(gap) if gap is not None else None
            except (ValueError, TypeError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            if path.endswith("boundary"):
                self._json(self.app.playback_boundary(ago, gap))
            else:
                self._json(self.app.playback_flip(ago, gap))
            return
        if path == "/api/admin/devices/authorize":
            payload = self._read_json_body()
            device_id, token = self.auth.authorize_device(str(payload.get("label") or "Aparelho"))
            body = json.dumps({"status": "ok", "id": device_id}).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header(
                "Set-Cookie",
                f"{self.DEVICE_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=63072000{self._secure_flag()}",
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/admin/devices/revoke":
            payload = self._read_json_body()
            self._json({"status": "ok" if self.auth.revoke_device(str(payload.get("id") or "")) else "not_found"})
            return
        if path == "/api/admin/devices/require":
            payload = self._read_json_body()
            enabled = bool(payload.get("enabled"))
            self.app.update_config({"REQUIRE_DEVICE_TOKEN": "1" if enabled else "0"})
            self._json({"status": "ok", "require_device_token": enabled})
            return
        if path == "/api/player/heartbeat":
            self._json(self.app.record_heartbeat(self._read_json_body(), self.headers.get("User-Agent", "")))
            return
        if path == "/api/admin/alerts/telegram_chats":
            # token no corpo (POST), nunca na URL: URLs ficam nos logs do nginx
            token = (str(self._read_json_body().get("token") or "") or self.app.config.telegram_bot_token or "").strip()
            from vinyl_display.notify import Notifier
            try:
                chats = Notifier(telegram_bot_token=token).telegram_chats()
                self._json({"status": "ok", "chats": chats})
            except Exception as error:
                self._json({"status": "error", "message": f"Não foi possível falar com o Telegram: {str(error).replace(token, '***') if token else error}"})
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/use_version"):
            try:
                release_id = int(path.split("/")[4])
                payload = self._read_json_body()
                vinyl_id = payload.get("vinyl_release_id")
                vinyl_id = int(vinyl_id) if vinyl_id not in (None, "") else None
            except (IndexError, TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            self._json(self.app.use_vinyl_version(release_id, vinyl_id))
            return
        if path.startswith("/api/admin/shelves/"):
            payload = self._read_json_body()
            action = path.rsplit("/", 1)[-1]
            store = self.app.store
            try:
                if action == "create":
                    store.create_shelf(str(payload.get("name") or ""), str(payload.get("emoji") or ""))
                elif action == "update":
                    store.update_shelf(int(payload["id"]), payload.get("name"), payload.get("emoji"))
                elif action == "delete":
                    store.delete_shelf(int(payload["id"]))
                elif action == "item":
                    note = payload.get("note")
                    store.set_shelf_item(
                        int(payload["shelf_id"]), int(payload["release_id"]),
                        bool(payload.get("present", True)), None if note is None else str(note),
                    )
                else:
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
            except (KeyError, TypeError, ValueError) as error:
                self._json_status({"status": "error", "message": str(error)}, HTTPStatus.BAD_REQUEST)
                return
            self._json({"status": "ok", "shelves": store.list_shelves()})
            return
        if path == "/api/admin/care/needle":
            from vinyl_display.journal import update_needle

            try:
                update_needle(self.app.store, self._read_json_body())
            except (TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            self._json(self.app.care())
            return
        if path == "/api/admin/care/needle/replace":
            from vinyl_display.journal import replace_needle

            replace_needle(self.app.store, str(self._read_json_body().get("model") or ""))
            self._json(self.app.care())
            return
        if path == "/api/admin/care/cleaned":
            import time as _time

            payload = self._read_json_body()
            try:
                release_id = int(payload.get("release_id"))
            except (TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            self.app.store.mark_cleaned(release_id, float(payload.get("at") or _time.time()))
            self._json(self.app.care())
            return
        if path == "/api/admin/alerts/test":
            if not self.app.notifier.enabled:
                self._json({"status": "error", "message": "Configure o Telegram (token e chat) ou um tópico do ntfy e salve antes de testar."})
                return
            sent = self.app.notifier.send("Teste de alerta: se você está lendo isto, os avisos do player vão chegar aqui. 👍")
            self._json({"status": "ok" if sent else "error", "channels": sent,
                        "message": "" if sent else "Nenhum canal aceitou a mensagem. Confira o token, o chat e o tópico."})
            return
        if path == "/api/playback/start_manual":
            payload = self._read_json_body()
            try:
                release_id = int(payload.get("release_id"))
            except (TypeError, ValueError):
                self.send_error(HTTPStatus.BAD_REQUEST)
                return
            self._json(self.app.start_manual_playback(release_id, str(payload.get("side") or "")))
            return
        if path == "/api/playback/keep_release":
            self._json(self.app.keep_playback_release())
            return
        if path == "/api/playback/stop":
            result = self.app.stop_playback()
            self._json(result)
            return
        if path == "/api/playback/switch_release":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            release_id = payload.get("release_id")
            if release_id is None:
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.end_headers()
                return
            result = self.app.switch_playback_release(int(release_id))
            self._json(result)
            return
        if path == "/api/admin/releases/add":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            payload = json.loads(body_bytes.decode("utf-8"))
            title = payload.get("title", "")
            artist = payload.get("artist", "")
            year = payload.get("year")
            if year is not None:
                try:
                    year = int(year)
                except ValueError:
                    year = None
            
            original_year = payload.get("original_year")
            if original_year is not None:
                try:
                    original_year = int(original_year)
                except ValueError:
                    original_year = None
                    
            edition_year = payload.get("edition_year")
            if edition_year is not None:
                try:
                    edition_year = int(edition_year)
                except ValueError:
                    edition_year = None

            cover_url = payload.get("cover_url", "")
            labels = payload.get("labels")
            catalog_numbers = payload.get("catalog_numbers")
            genres = payload.get("genres")
            styles = payload.get("styles")
            notes = payload.get("notes", "")
            rating = int(payload.get("rating", 0))
            favorite = bool(payload.get("favorite", False))
            
            self._json(
                self.app.add_manual_release(
                    title=title,
                    artist=artist,
                    year=year,
                    cover_url=cover_url,
                    labels=labels,
                    catalog_numbers=catalog_numbers,
                    genres=genres,
                    styles=styles,
                    notes=notes,
                    rating=rating,
                    favorite=favorite,
                    original_year=original_year,
                    edition_year=edition_year,
                )
            )
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/edit"):
            parts = path.split("/")
            release_id = int(parts[4])
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            payload = json.loads(body_bytes.decode("utf-8"))
            
            title = payload.get("title", "")
            artist = payload.get("artist", "")
            year = payload.get("year")
            if year is not None:
                try:
                    year = int(year)
                except ValueError:
                    year = None
                    
            original_year = payload.get("original_year")
            if original_year is not None:
                try:
                    original_year = int(original_year)
                except ValueError:
                    original_year = None
                    
            edition_year = payload.get("edition_year")
            if edition_year is not None:
                try:
                    edition_year = int(edition_year)
                except ValueError:
                    edition_year = None

            cover_url = payload.get("cover_url", "")
            labels = payload.get("labels")
            catalog_numbers = payload.get("catalog_numbers")
            genres = payload.get("genres")
            styles = payload.get("styles")
            notes = payload.get("notes", "")
            rating = int(payload.get("rating", 0))
            
            self._json(
                self.app.update_release_details(
                    release_id=release_id,
                    title=title,
                    artist=artist,
                    year=year,
                    cover_url=cover_url,
                    labels=labels,
                    catalog_numbers=catalog_numbers,
                    genres=genres,
                    styles=styles,
                    notes=notes,
                    rating=rating,
                    original_year=original_year,
                    edition_year=edition_year,
                )
            )
            return

        if path == "/api/admin/agenda":
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {}
            ids = payload.get("ids", [])
            if not isinstance(ids, list) or len(ids) != 7:
                body = json.dumps({"success": False, "error": "A agenda deve ter exatamente 7 LPs."}, ensure_ascii=False).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.app.store.set_metadata("weekly_agenda_ids", json.dumps(ids))
            
            from datetime import datetime, timedelta, timezone
            tz_brt = timezone(timedelta(hours=-3))
            now = datetime.now(tz_brt)
            # Início da semana (domingo)
            days_since_sunday = (now.weekday() + 1) % 7
            start_of_week = now - timedelta(days=days_since_sunday)
            week_key = start_of_week.strftime("%Y-%m-%d")
            
            self.app.store.set_metadata("weekly_agenda_week_key", week_key)
            
            hist_str = self.app.store.get_metadata("historical_agendas")
            historical = {}
            if hist_str:
                try:
                    historical = json.loads(hist_str)
                except:
                    pass
            historical[week_key] = ids
            self.app.store.set_metadata("historical_agendas", json.dumps(historical))
            
            self._json({"success": True})
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/delete"):
            parts = path.split("/")
            release_id = int(parts[4])
            self._json(self.app.delete_release(release_id))
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/favorite"):
            parts = path.split("/")
            release_id = int(parts[4])
            self._json(self.app.toggle_favorite(release_id))
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/rate"):
            parts = path.split("/")
            release_id = int(parts[4])
            length = int(self.headers.get("Content-Length", "0"))
            body_bytes = self.rfile.read(length)
            payload = json.loads(body_bytes.decode("utf-8"))
            rating = int(payload.get("rating", 0))
            self._json(self.app.update_release_rating(release_id, rating))
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/listen"):
            parts = path.split("/")
            release_id = int(parts[4])
            self._json(self.app.increment_release_auditions(release_id))
            return
        if path.startswith("/api/ouvir/releases/") and path.endswith("/listen"):
            parts = path.split("/")
            release_id = int(parts[4])
            self._json(self.app.increment_release_auditions(release_id))
            return
        if path.startswith("/api/admin/releases/") and path.endswith("/unlisten"):
            parts = path.split("/")
            release_id = int(parts[4])
            self._json(self.app.decrement_release_auditions(release_id))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _send_static(self, relative_path: str) -> None:
        target = (self.static_dir / relative_path).resolve()
        static_root = self.static_dir.resolve()
        if static_root not in target.parents and target != static_root:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if content_type == "text/html":
            # páginas sempre conferem a versão nova (os .js/.css já levam ?v=)
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict) -> None:
        self._json_status(payload, HTTPStatus.OK)

    def _json_status(self, payload: dict, status: HTTPStatus) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(config: Config | None = None) -> None:
    config = config or load_config()
    app = build_app(config)

    auth = AuthManager(config.data_dir)

    class Handler(VinylRequestHandler):
        pass

    Handler.app = app
    Handler.static_dir = config.static_dir
    Handler.auth = auth

    def watchdog_loop() -> None:
        import time as _time

        while True:
            _time.sleep(60)
            try:
                app.run_watchdog()
            except Exception as error:
                print(f"[WATCHDOG] {error}")

    import threading as _threading

    _threading.Thread(target=watchdog_loop, daemon=True, name="watchdog").start()

    from vinyl_display.assistant import TelegramCommands

    _threading.Thread(target=TelegramCommands(app).run_forever, daemon=True, name="telegram-commands").start()

    server = ThreadingHTTPServer((config.host, config.port), Handler)
    if config.cert_file and config.key_file:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(config.cert_file, config.key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    scheme = "https" if config.cert_file and config.key_file else "http"
    print(f"Serving Vinyl Display at {scheme}://{config.host}:{config.port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()

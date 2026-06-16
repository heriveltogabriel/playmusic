import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticAssetTests(unittest.TestCase):
    def test_index_contains_required_mount_points(self):
        html = (ROOT / "static" / "index.html").read_text()
        admin_html = (ROOT / "static" / "admin.html").read_text()

        self.assertIn('id="album-cover"', html)
        self.assertIn('id="track-title"', html)
        self.assertIn('id="artist-name"', html)
        self.assertIn('id="admin-sync-btn"', admin_html)

    def test_app_uses_microphone_and_media_recorder(self):
        js = (ROOT / "static" / "app.js").read_text()

        self.assertIn("navigator.mediaDevices.getUserMedia", js)
        self.assertIn("MediaRecorder", js)
        self.assertIn("/api/recognize", js)
        self.assertIn("/api/state", js)
        self.assertIn("MediaRecorder.isTypeSupported", js)
        self.assertNotIn("innerHTML", js)
        self.assertIn("Permissão do microfone negada", js)

    def test_css_is_amoled_friendly_and_has_no_negative_letter_spacing(self):
        css = (ROOT / "static" / "styles.css").read_text()

        self.assertIn("background: var(--bg)", css)
        self.assertNotIn("letter-spacing: -", css)
        self.assertNotIn("font-size: clamp", css)
        font_size_declarations = re.findall(r"font-size:[^;]+;", css)
        self.assertFalse(
            [declaration for declaration in font_size_declarations if "vw" in declaration],
        )

    def test_catalog_search_preserves_spaces_while_typing(self):
        js = (ROOT / "static" / "admin.js").read_text()

        self.assertIn("handleSearchUpdate(e.target.value);", js)
        self.assertNotIn("handleSearchUpdate(e.target.value.trim());", js)
        self.assertIn("state.filters.search.trim().toLowerCase()", js)

    def test_weekly_suggestion_screen_uses_focused_listening_layout(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertIn("Escuta da Semana", html)
        self.assertIn("Escuta da Semana", js)
        self.assertIn('class="weekly-agenda-panel"', html)
        self.assertIn('class="featured-suggestion-panel"', html)
        self.assertIn('id="suggested-reason"', html)
        self.assertIn("Por que ouvir agora?", html)
        self.assertIn('class="suggestion-support-grid"', html)
        self.assertIn("function getSuggestionReason(lp)", js)
        self.assertIn("Ainda sem audições", js)
        self.assertIn(".weekly-agenda-panel", css)
        self.assertIn(".featured-suggestion-panel", css)
        self.assertIn("grid-template-columns: repeat(7, minmax(112px, 1fr));", css)
        self.assertIn(".suggestion-reason-card", css)
        self.assertIn(".suggestion-support-grid", css)

    def test_plays_ranking_bars_use_absolute_progress(self):
        js = (ROOT / "static" / "admin.js").read_text()

        self.assertIn("function playsToProgressPercent(plays)", js)
        self.assertIn("function renderPlaysChart()", js)
        self.assertIn("renderPlaysChart();", js)
        self.assertIn("return Math.min(Math.round(count), 100);", js)
        self.assertNotIn("maxPlaysLeader", js)
        self.assertNotIn("lp.plays / maxPlaysLeader", js)

    def test_plays_chart_lives_on_ranking_page_not_stats_page(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()

        ranking_start = html.index('id="view-ranking"')
        stats_start = html.index('id="view-stats"')
        self.assertLess(ranking_start, html.index('id="plays-chart-container"'))
        self.assertGreater(stats_start, html.index('id="plays-chart-container"'))
        self.assertIn('<h3 class="ranking-section-title">LPs por Audição</h3>', html)
        self.assertNotIn("Outros Discos Ouvidos", html)
        self.assertNotIn("ranking-grid'", js)
        self.assertNotIn('getElementById("ranking-grid")', js)

    def test_catalog_cards_show_year_on_the_right_without_favorite_button(self):
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertIn('class="lp-card-year"', js)
        self.assertNotIn("lp-card-favorite-btn", js)
        self.assertIn("justify-content: flex-end;", css)
        self.assertNotIn(".lp-card-favorite-btn", css)

    def test_artist_albums_dialog_has_narrow_dedicated_width(self):
        html = (ROOT / "static" / "admin.html").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertIn('id="artist-albums-dialog"', html)
        self.assertIn("#artist-albums-dialog", css)
        self.assertIn("max-width: 560px;", css)
        self.assertIn("width: min(92vw, 560px);", css)
        self.assertNotIn('artist-albums-dialog-content" style=', html)

    def test_timeline_does_not_show_manual_audition_button(self):
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertNotIn("timeline-scrobble-btn", js)
        self.assertNotIn("timeline-scrobble-btn", css)
        self.assertNotIn("timeline-actions", js)
        self.assertNotIn("timeline-actions", css)

    def test_timeline_statistics_live_on_stats_page(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertNotIn('id="timeline-stats-btn"', html)
        self.assertNotIn('id="timeline-stats-dialog"', html)
        self.assertNotIn("openTimelineStatsDialog", js)
        self.assertIn('id="timeline-stats-section"', html)
        self.assertIn("Crescimento da Coleção", html)
        self.assertIn('id="timeline-monthly-chart"', html)
        self.assertIn("function renderTimelineStats()", js)
        self.assertIn("renderTimelineStats();", js)
        self.assertIn(".timeline-stats-section", css)

    def test_stats_cards_use_listened_collection_and_total_plays(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertNotIn("Média de Avaliação", html)
        self.assertNotIn("stat-avg-rating", html)
        self.assertNotIn("avgRating", js)
        self.assertNotIn("Favoritados", html)
        self.assertNotIn("stat-total-starred", html)
        self.assertNotIn("stat-total-starred", js)
        self.assertIn("Coleção Ouvida", html)
        self.assertIn('id="stat-listened-percent"', html)
        self.assertIn("Total de Audições", html)
        self.assertIn('id="stat-total-plays"', html)
        self.assertIn("const listenedLps = state.lps.filter", js)
        self.assertIn("const listenedPercent = totalLps > 0", js)
        self.assertIn("const totalPlays = state.lps.reduce", js)
        self.assertIn("document.getElementById('stat-listened-percent').textContent = `${listenedPercent}%`;", js)
        self.assertIn("document.getElementById('stat-total-plays').textContent = totalPlays;", js)
        self.assertIn("grid-template-columns: repeat(4, 1fr);", css)
        self.assertIn("color: var(--primary);", css)

    def test_add_lp_uses_settings_token_and_locks_fields_until_discogs_selection(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertNotIn("discogs-config-btn", html)
        self.assertNotIn("discogs-token-config", html)
        self.assertNotIn("discogs-token-input", html)
        self.assertIn("selecione um resultado para preencher e editar os dados", html)
        self.assertNotIn("lpweek_discogs_token", js)
        self.assertIn("fetch(`/api/search?q=${encodeURIComponent(query)}`)", js)
        self.assertNotIn("token=${encodeURIComponent(token)}", js)
        self.assertIn("function setLpFormFieldsLocked(locked)", js)
        self.assertIn("setLpFormFieldsLocked(!editId);", js)
        self.assertIn("setLpFormFieldsLocked(false);", js)
        self.assertIn("readonly-field", css)
        self.assertIn("readonly-stars", css)

    def test_album_details_dialog_has_favorite_button(self):
        html = (ROOT / "static" / "admin.html").read_text()
        js = (ROOT / "static" / "admin.js").read_text()
        css = (ROOT / "static" / "admin.css").read_text()

        self.assertIn('id="details-favorite-btn"', html)
        self.assertIn('id="details-favorite-label"', html)
        self.assertIn('id="details-unlisten-btn"', html)
        self.assertIn('<span class="audition-stepper-symbol" aria-hidden="true">-</span>', html)
        self.assertIn('<span class="audition-stepper-symbol" aria-hidden="true">+</span>', html)
        self.assertIn('class="details-cover-column"', html)
        self.assertIn('class="details-audition-stepper"', html)
        self.assertIn('<span id="details-plays-count">0</span>', html)
        self.assertIn('id="details-edit-btn" class="btn btn-secondary btn-icon"', html)
        self.assertIn('id="details-delete-btn" class="btn btn-danger-text btn-icon"', html)
        self.assertLess(
            html.index('class="details-audition-stepper"'),
            html.index('class="details-info-container"'),
        )
        self.assertIn("Excluir", html)
        self.assertIn("function updateDetailsFavoriteBtn(lp)", js)
        self.assertIn("function updateDetailsAuditionControls(lp)", js)
        self.assertIn("async function unmarkAsListened(id)", js)
        self.assertIn("/api/admin/releases/${id}/unlisten", js)
        self.assertIn("label.textContent = lp.favorite ? 'Favorito' : 'Favoritar';", js)
        self.assertIn("toggleFavoriteState(lp.id);", js)
        self.assertIn("updateDetailsFavoriteBtn(lp);", js)
        self.assertIn(".details-cover-column", css)
        self.assertIn(".details-audition-stepper {", css)
        self.assertIn(".audition-stepper-btn", css)
        self.assertIn(".audition-stepper-symbol", css)
        self.assertIn("#details-delete-btn {", css)
        self.assertIn("flex: 1 1 0;", css)
        self.assertNotIn("margin-left: auto;", css)
        self.assertIn("#details-favorite-btn.active", css)

    def test_ouvir_scrobble_page(self):
        html = (ROOT / "static" / "ouvir.html").read_text()
        js = (ROOT / "static" / "ouvir.js").read_text()
        css = (ROOT / "static" / "ouvir.css").read_text()

        self.assertIn('id="ouvir-grid"', html)
        self.assertIn('id="search-input"', html)
        self.assertIn('/api/ouvir/releases', js)
        self.assertIn('listen-btn', js)
        self.assertIn('toast-success', css)
        self.assertIn('glass-border', css)

    def test_agenda_page(self):
        html = (ROOT / "static" / "agenda.html").read_text()
        js = (ROOT / "static" / "agenda.js").read_text()
        css = (ROOT / "static" / "agenda.css").read_text()

        self.assertIn('id="agenda-grid"', html)
        self.assertIn('/api/ouvir/agenda', js)
        self.assertNotIn('lpweek_daily_agenda_ids', js)
        self.assertIn('listened-check', css)
        self.assertIn('agenda-card.today', css)

    def test_herivelto_profile_page(self):
        html = (ROOT / "static" / "herivelto.html").read_text()
        css = (ROOT / "static" / "herivelto.css").read_text()

        self.assertIn("Herivelto Gabriel", html)
        self.assertIn("https://heriveltogabriel.com.br/admin", html)
        self.assertIn("https://heriveltogabriel.com.br/ouvir", html)
        self.assertIn("https://heriveltogabriel.com.br/vinyl/", html)
        self.assertIn("https://lpdasemana.com.br/gerador.html", html)
        self.assertIn("https://lpdasemana.com.br", html)
        self.assertIn("http://150.136.207.62:5001/", html)
        self.assertIn("Outfit", css)
        self.assertIn("backdrop-filter", css)


if __name__ == "__main__":
    unittest.main()

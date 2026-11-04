from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def admin_js_source() -> str:
    """O admin foi dividido em vários arquivos (v4.0); os testes leem todos, na ordem."""
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted((ROOT / "static" / "admin").glob("*.js")))

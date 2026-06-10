import re

css_path = "static/admin.css"
with open(css_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace RGBA colors
content = content.replace("255, 45, 85", "230, 92, 0")

# Replace hex colors
content = content.replace("#ff2d55", "#e65c00")
content = content.replace("#ff456e", "#ff751a")
content = content.replace("#ff527b", "#ff8c1a")

# Replace base background and surface colors
content = content.replace("#060609", "#0c0c0c")
content = content.replace("#07070b", "#0c0c0c")
content = content.replace("#12121c", "#161616")
content = content.replace("#12121a", "#161616")
content = content.replace("rgba(12, 12, 18, 0.75)", "rgba(22, 22, 22, 0.75)")
content = content.replace("rgba(20, 20, 30, 0.45)", "rgba(22, 22, 22, 0.45)")
content = content.replace("rgba(30, 30, 42, 0.35)", "rgba(22, 22, 22, 0.35)")
content = content.replace("rgba(40, 40, 56, 0.55)", "rgba(30, 30, 30, 0.55)")

# Replace border colors
content = content.replace("rgba(255, 255, 255, 0.08)", "rgba(234, 229, 217, 0.08)")
content = content.replace("rgba(255, 255, 255, 0.06)", "rgba(234, 229, 217, 0.06)")

# Replace text colors in variables only
content = content.replace("--text-primary: #ffffff;", "--text-primary: #eae5d9;")
content = content.replace("--text-secondary: #a0a0b0;", "--text-secondary: #a09a8e;")
content = content.replace("--text-muted: #5e5e66;", "--text-muted: #5e584f;")

with open(css_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Replacement complete.")

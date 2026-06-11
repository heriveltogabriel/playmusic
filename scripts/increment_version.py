#!/usr/bin/env python3
import os
import subprocess
import sys

def main():
    # Find project root (directory containing this script's parent)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    version_file_path = os.path.join(root_dir, "version.txt")

    if not os.path.exists(version_file_path):
        print("version.txt not found, starting at 1.0.0")
        new_version = "1.0.0"
    else:
        with open(version_file_path, "r") as f:
            current_version = f.read().strip()
        
        try:
            parts = current_version.split(".")
            if len(parts) >= 3:
                major, minor, patch = parts[0], parts[1], parts[2]
                new_patch = int(patch) + 1
                new_version = f"{major}.{minor}.{new_patch}"
            else:
                new_version = "1.0.0"
        except Exception as e:
            print(f"Error parsing version '{current_version}': {e}. Resetting to 1.0.0")
            new_version = "1.0.0"

    print(f"Incrementing version to {new_version}...")
    with open(version_file_path, "w") as f:
        f.write(new_version + "\n")

    # Stage the version file in git
    try:
        subprocess.run(["git", "add", "version.txt"], cwd=root_dir, check=True)
        print("Successfully staged version.txt in Git.")
    except Exception as e:
        print(f"Warning: Failed to run git add: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()

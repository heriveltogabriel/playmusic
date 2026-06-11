#!/usr/bin/env python3
import os
import sys
from pathlib import Path

# Add project root to sys.path
script_dir = Path(__file__).resolve().parent
project_root = script_dir.parent
sys.path.insert(0, str(project_root))

from vinyl_display.auth import AuthManager

def main():
    data_dir = project_root / "data"
    print(f"Initializing AuthManager with data directory: {data_dir}")
    auth = AuthManager(data_dir)
    
    print("Resetting administrator credentials to default values...")
    auth.reset_to_default(save=True)
    print("SUCCESS: Credentials reset to default.")
    print("Default Password: admin123")
    print("You will be prompted to change this password on your next login.")

if __name__ == "__main__":
    main()

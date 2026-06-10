#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "============================================="
echo "  Vinyl Display - Raspberry Pi Setup Script  "
echo "============================================="

# 1. Check if running on Linux (Raspberry Pi OS)
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "⚠️ Warning: This script is designed for Linux (Raspberry Pi OS / Debian). Continuing anyway..."
fi

# 2. Check for python3 and openssl
echo "Checking for required system packages..."
if ! command -v python3 &> /dev/null; then
    echo "Python 3 not found. Installing..."
    sudo apt-get update && sudo apt-get install -y python3
else
    echo "✅ Python 3 is installed."
fi

if ! command -v openssl &> /dev/null; then
    echo "OpenSSL not found. Installing..."
    sudo apt-get update && sudo apt-get install -y openssl
else
    echo "✅ OpenSSL is installed."
fi

# 3. Create necessary directories
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$PROJECT_DIR"

mkdir -p certs
mkdir -p data

# 4. Generate Self-Signed SSL Certificate if not present
# Browsers require HTTPS to access the microphone/MediaRecorder API
CERT_FILE="$PROJECT_DIR/certs/cert.pem"
KEY_FILE="$PROJECT_DIR/certs/key.pem"

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "Generating self-signed SSL certificates for HTTPS (needed for browser microphone access)..."
    openssl req -x509 -newkey rsa:4096 -keyout "$KEY_FILE" -out "$CERT_FILE" -sha256 -days 365 -nodes \
        -subj "/C=BR/ST=State/L=City/O=VinylDisplay/OU=App/CN=raspberrypi.local"
    echo "✅ Certificates generated in $PROJECT_DIR/certs/"
else
    echo "✅ Self-signed SSL certificates already exist."
fi

# Set permissions
chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

# 5. Handle .env configuration
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env configuration file from template..."
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    
    echo "Updating paths in .env..."
    # Point the environment to the certificates we just generated
    if [ "$(uname)" = "Darwin" ]; then
        sed -i "" "s|# export VINYL_CERT_FILE=.*|export VINYL_CERT_FILE=\"$CERT_FILE\"|g" "$ENV_FILE"
        sed -i "" "s|# export VINYL_KEY_FILE=.*|export VINYL_KEY_FILE=\"$KEY_FILE\"|g" "$ENV_FILE"
    else
        sed -i "s|# export VINYL_CERT_FILE=.*|export VINYL_CERT_FILE=\"$CERT_FILE\"|g" "$ENV_FILE"
        sed -i "s|# export VINYL_KEY_FILE=.*|export VINYL_KEY_FILE=\"$KEY_FILE\"|g" "$ENV_FILE"
    fi
    
    echo "------------------------------------------------------------"
    echo "⚠️  Important: Please fill in your API tokens in the .env file."
    echo "File location: $ENV_FILE"
    echo "You can use either AudD or Shazam (via RapidAPI)."
    echo "------------------------------------------------------------"
else
    echo "✅ .env configuration file already exists."
    # If the cert paths are commented in .env, let's make sure they are active
    if grep -q "# export VINYL_CERT_FILE" "$ENV_FILE"; then
        echo "Activating cert paths in existing .env..."
        if [ "$(uname)" = "Darwin" ]; then
            sed -i "" "s|# export VINYL_CERT_FILE=.*|export VINYL_CERT_FILE=\"$CERT_FILE\"|g" "$ENV_FILE"
            sed -i "" "s|# export VINYL_KEY_FILE=.*|export VINYL_KEY_FILE=\"$KEY_FILE\"|g" "$ENV_FILE"
        else
            sed -i "s|# export VINYL_CERT_FILE=.*|export VINYL_CERT_FILE=\"$CERT_FILE\"|g" "$ENV_FILE"
            sed -i "s|# export VINYL_KEY_FILE=.*|export VINYL_KEY_FILE=\"$KEY_FILE\"|g" "$ENV_FILE"
        fi
    fi
fi

# 6. Create systemd Service file
SERVICE_NAME="vinyl-display"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Configuring systemd service..."

# We generate the service content
cat <<EOF | sudo tee "$SERVICE_FILE" > /dev/null
[Unit]
Description=Vinyl Display PWA Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/python3 -m vinyl_display.server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 7. Reload systemd and enable/start service
echo "Starting and enabling systemd service..."
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Get local IP
IP_ADDRESS=$(hostname -I | awk '{print $1}')
if [ -z "$IP_ADDRESS" ]; then
    IP_ADDRESS="localhost"
fi

echo "============================================="
echo "🎉 Setup Complete!"
echo "============================================="
echo "The service is now running in the background."
echo "You can access the PWA here: https://${IP_ADDRESS}:8080"
echo "---------------------------------------------"
echo "Commands to manage the service:"
echo "  - Check status:  sudo systemctl status $SERVICE_NAME"
echo "  - Restart:       sudo systemctl restart $SERVICE_NAME"
echo "  - View logs:     journalctl -u $SERVICE_NAME -f"
echo "============================================="

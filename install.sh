#!/usr/bin/env bash
# Installe (ou met à jour) Atelier sur un VPS Ubuntu, en une commande :
#   curl -fsSL https://raw.githubusercontent.com/m1france/levelup/main/install.sh | sudo bash -s mondomaine.fr
# Relancer la même commande plus tard met l'application à jour.
set -euo pipefail

DOMAIN="${1:?Indiquez le nom de domaine, par exemple : bash -s mondomaine.fr}"
REPO="https://github.com/m1france/levelup.git"
# Port interne de l'application (peu courant, pour ne pas gêner d'autres sites du serveur).
PORT=4310
HOME_DIR=/srv/atelier
APP="$HOME_DIR/app"
DATA="$HOME_DIR/data"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }

# Un serveur Caddy déjà en place (autres sites) : on s'y greffe au lieu d'installer Nginx.
USE_CADDY=0
if systemctl is-active --quiet caddy 2>/dev/null; then USE_CADDY=1; fi

step "Installation des logiciels"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y nodejs git
[ "$USE_CADDY" = 1 ] || apt-get install -y nginx certbot python3-certbot-nginx

step "Utilisateur et dossiers"
id atelier >/dev/null 2>&1 || adduser --system --group --home "$HOME_DIR" atelier
mkdir -p "$DATA/uploads"
chown -R atelier:atelier "$HOME_DIR"

step "Récupération du code"
if [ -d "$APP/.git" ]; then
  sudo -u atelier git -C "$APP" pull --ff-only
else
  sudo -u atelier git clone "$REPO" "$APP"
fi
# Les données (base + photos) vivent hors du code : une mise à jour ne les touche jamais.
[ -e "$APP/data" ] || sudo -u atelier ln -s "$DATA" "$APP/data"

step "Compilation"
cd "$APP"
sudo -u atelier npm ci --no-audit --no-fund
sudo -u atelier npm run build

step "Service de l'application"
cat > /etc/systemd/system/atelier.service <<UNIT
[Unit]
Description=Atelier
After=network.target

[Service]
User=atelier
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATABASE_FILE=$DATA/atelier.db
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable atelier >/dev/null
systemctl restart atelier

step "Serveur web"
# www.domaine n'est ajouté que s'il pointe déjà quelque part.
NAMES="$DOMAIN"
getent hosts "www.$DOMAIN" >/dev/null && NAMES="$DOMAIN www.$DOMAIN"

if [ "$USE_CADDY" = 1 ]; then
  # Nginx ne doit pas disputer les ports 80/443 à Caddy.
  systemctl disable --now nginx >/dev/null 2>&1 || true
  CADDYFILE=/etc/caddy/Caddyfile
  if grep -q "# atelier:$PORT" "$CADDYFILE" 2>/dev/null; then
    echo "Le site est déjà déclaré dans Caddy."
  elif grep -qE "(^|[[:space:],/])$DOMAIN([[:space:],:{]|$)" "$CADDYFILE" 2>/dev/null; then
    echo "Attention : $DOMAIN est déjà utilisé par un autre site dans $CADDYFILE."
    echo "Rien n'a été modifié. Envoyez une capture de ces lignes :"
    grep -nE "$DOMAIN" "$CADDYFILE"
    exit 1
  else
    cp "$CADDYFILE" "$CADDYFILE.bak-atelier"
    SITE=$(echo "$NAMES" | sed 's/ /, /')
    cat >> "$CADDYFILE" <<SITEBLOCK

# atelier:$PORT
$SITE {
	request_body {
		max_size 10MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
SITEBLOCK
    if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
      systemctl reload caddy
      echo "Site ajouté à Caddy : le HTTPS s'active tout seul."
    else
      mv "$CADDYFILE.bak-atelier" "$CADDYFILE"
      echo "La configuration Caddy était invalide : elle a été remise comme avant."
      exit 1
    fi
  fi
else
  if [ ! -f /etc/nginx/sites-available/atelier ]; then
    cat > /etc/nginx/sites-available/atelier <<NGINX
server {
    listen 80;
    server_name $NAMES;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    ln -sf /etc/nginx/sites-available/atelier /etc/nginx/sites-enabled/atelier
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
  if ufw status 2>/dev/null | grep -q "Status: active"; then ufw allow 'Nginx Full' >/dev/null; fi

  step "Certificat HTTPS"
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "Certificat déjà en place."
  else
    CERT_ARGS=()
    for n in $NAMES; do CERT_ARGS+=(-d "$n"); done
    if certbot --nginx "${CERT_ARGS[@]}" --redirect --non-interactive --agree-tos --register-unsafely-without-email; then
      echo "HTTPS activé."
    else
      echo "Le certificat n'a pas pu être créé : le domaine ne pointe sans doute pas encore vers ce serveur."
      echo "Attendez quelques minutes puis relancez la même commande."
    fi
  fi
fi

step "Terminé"
echo "Ouvrez https://$DOMAIN et créez tout de suite votre compte administrateur."

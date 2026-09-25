#!/usr/bin/env bash
# Installe (ou met à jour) Atelier sur un VPS Ubuntu, en une commande :
#   curl -fsSL https://raw.githubusercontent.com/m1france/levelup/main/install.sh | sudo bash -s mondomaine.fr
# Relancer la même commande plus tard met l'application à jour.
set -euo pipefail

DOMAIN="${1:?Indiquez le nom de domaine, par exemple : bash -s mondomaine.fr}"
REPO="https://github.com/m1france/levelup.git"
HOME_DIR=/srv/atelier
APP="$HOME_DIR/app"
DATA="$HOME_DIR/data"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }

step "Installation des logiciels (Node.js 22, Nginx, Git, Certbot)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y nodejs nginx git certbot python3-certbot-nginx

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
cat > /etc/systemd/system/atelier.service <<EOF
[Unit]
Description=Atelier
After=network.target

[Service]
User=atelier
WorkingDirectory=$APP
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_FILE=$DATA/atelier.db
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable atelier >/dev/null
systemctl restart atelier

step "Serveur web (Nginx)"
# www.domaine n'est ajouté que s'il pointe déjà quelque part.
NAMES="$DOMAIN"
getent hosts "www.$DOMAIN" >/dev/null && NAMES="$DOMAIN www.$DOMAIN"
if [ ! -f /etc/nginx/sites-available/atelier ]; then
  cat > /etc/nginx/sites-available/atelier <<EOF
server {
    listen 80;
    server_name $NAMES;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/atelier /etc/nginx/sites-enabled/atelier
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
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

step "Terminé"
echo "Ouvrez https://$DOMAIN et créez tout de suite votre compte administrateur."

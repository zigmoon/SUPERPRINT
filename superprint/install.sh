#!/bin/bash
# ============================================================
#  SuperPrint — Installateur macOS / Linux
#  Utilisation :  curl -fsSL https://superprint.cc/install.sh | bash
#  Télécharge, décompresse, installe et lance SuperPrint en local.
# ============================================================
set -e

ZIP_URL="https://app.zigmoon.com/sp213-local.zip"
INSTALL_ROOT="$HOME/sp213-local"

# Couleurs
GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'

fail() {
    echo -e "\n${CYAN}ERREUR${NC}  $1" >&2
    exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl est requis pour télécharger SuperPrint."
command -v node >/dev/null 2>&1 || fail "Node.js 18 ou plus récent est requis : https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "npm est requis (il est inclus avec Node.js)."
NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18 ou plus récent est requis (version détectée : $(node -v))."

echo ""
echo -e "${CYAN}SUPERPRINT${NC}"
echo -e "${GREEN}  PAO + Studio SP213 - 100% local${NC}"
echo ""

# Étape 1 : préparation
echo -e "${CYAN}[1/4]${NC} Préparation du dossier"
if [ -f "$INSTALL_ROOT/package.json" ]; then
    echo -e "${GREEN}  OK${NC} Projet déjà présent dans $INSTALL_ROOT"
    cd "$INSTALL_ROOT"
else
    mkdir -p "$INSTALL_ROOT"
    echo -e "${GREEN}  OK${NC} Dossier créé : $INSTALL_ROOT"
fi

# Étape 2 : téléchargement
echo -e "${CYAN}[2/4]${NC} Téléchargement de SuperPrint"
ZIP_PATH="$HOME/sp213-local.zip"
ZIP_PART="$ZIP_PATH.part"
trap 'rm -f "$ZIP_PART"' EXIT
rm -f "$ZIP_PART"
echo -e "${DIM}  Téléchargement...${NC}"
curl -fsSL "$ZIP_URL" -o "$ZIP_PART"
mv "$ZIP_PART" "$ZIP_PATH"
echo -e "${GREEN}  OK${NC} Zip téléchargé"

# Étape 3 : décompression + installation
echo -e "${CYAN}[3/4]${NC} Décompression et installation"
if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$ZIP_PATH" -d "$INSTALL_ROOT"
elif command -v tar >/dev/null 2>&1; then
    tar -xf "$ZIP_PATH" -C "$INSTALL_ROOT"
elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$ZIP_PATH" "$INSTALL_ROOT"
else
    fail "Impossible de décompresser : installez unzip, tar ou python3."
fi
rm -f "$ZIP_PATH"
cd "$INSTALL_ROOT"
echo -e "${GREEN}  OK${NC} Paquet décompressé"

echo -e "${DIM}  Installation des dépendances (npm install)...${NC}"
npm install --no-audit --no-fund
# npm 12 peut mettre en attente le postinstall d'esbuild. Cette commande est
# absente des anciennes versions de npm : son échec est alors sans conséquence.
if npm install-scripts approve --all >/dev/null 2>&1; then
    echo -e "${GREEN}  OK${NC} Scripts natifs approuvés"
fi
echo -e "${GREEN}  OK${NC} Dépendances installées"

# Étape 4 : lancement
echo -e "${CYAN}[4/4]${NC} Lancement du serveur"
echo -e "${GREEN}  Ouvrez l'adresse affichée par Vite dans votre navigateur${NC}"
echo -e "${DIM}  (Ctrl+C pour arrêter)${NC}"
npm run dev

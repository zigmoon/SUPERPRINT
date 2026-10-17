# SuperPrint — Serveur MCP

Ce serveur expose **SuperPrint** à un client MCP : **Claude Desktop**, **Claude
Code**, **Cursor**, ou n'importe quel hôte qui parle le Model Context Protocol.

L'assistant peut alors lire un document, le convertir, en créer un, et composer
un motif — sans passer par l'interface graphique.

---

## Ce qu'il fait

| Outil | Rôle |
|---|---|
| `superprint_formats` | Liste les formats de page connus, en millimètres |
| `superprint_inspect` | Résume un `.sp` ou `.json` : format, pages, objets, marges, fond perdu |
| `superprint_convert` | Convertit `.sp → .json` ou `.json → .sp` |
| `superprint_create` | Crée un document (format, pages, texte) et l'écrit |
| `superprint_pattern` | Crée un document habillé d'un motif répété |

---

## Installation

**Aucune dépendance.** Le serveur n'utilise que Node (≥ 18). Il n'y a pas de
`npm install` à faire : le protocole MCP sur `stdio` est du JSON-RPC 2.0
délimité par des sauts de ligne, et l'implémenter directement évite un registre
inaccessible, un proxy d'entreprise ou une coupure réseau au premier lancement.

```bash
cd superprint/mcp-server
node server.mjs
```

Le serveur écrit `[superprint-mcp] vX prêt (5 outils)` sur **stderr** et attend
des requêtes sur **stdin**. Rien ne sort sur stdout en dehors des réponses
JSON-RPC — un `console.log` mal placé casserait le protocole.

---

## Brancher un client

### Claude Desktop

Éditez `claude_desktop_config.json` :

- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux** — `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "superprint": {
      "command": "node",
      "args": ["/chemin/absolu/vers/superprint/mcp-server/server.mjs"]
    }
  }
}
```

Redémarrez Claude Desktop. Les cinq outils apparaissent dans la liste.

### Claude Code / Cursor

```bash
claude mcp add superprint -- node /chemin/absolu/vers/superprint/mcp-server/server.mjs
```

---

## Exemples

Une fois branché, demandez simplement :

> **« Crée une affiche A4 avec un motif d'étoiles rouges tous les 12 mm, et dis-moi combien d'objets elle contient. »**

L'assistant appellera `superprint_pattern`, puis `superprint_inspect`, et
répondra avec le chemin du fichier et le résumé.

> **« Ouvre `maquette.sp`, convertis-la en JSON, puis relis-la pour vérifier que rien n'a été perdu. »**

---

## Les deux formats, et pourquoi ils diffèrent

| | `.sp` | `.json` |
|---|---|---|
| Usage | Format natif, échange app ↔ Studio IA | Sauvegarde de projet |
| `document.format` | `{ width, height }` en mm | — |
| `pageFormat` | — | `[largeur, hauteur]` en mm |
| `pages[].objects` | **tableau** d'objets | **chaîne** JSON |

`superprint_convert` gère les deux sens et **ne traduit pas les objets** : ils
sont déjà au bon format. C'est exactement ce que fait le Studio IA depuis la
1.7.637.

---

## Unités

Le fichier `.sp` stocke les positions en **points** (1 mm = 72/25,4 pt) et le
format du document en **millimètres**. Le serveur convertit aux deux endroits
où c'est nécessaire et nulle part ailleurs. C'est l'erreur la plus facile à
commettre : un `left: 20` veut dire 20 **points**, soit 7 mm — pas 20 mm.

---

## Limites assumées

- Le serveur travaille sur des **fichiers**, jamais sur l'application ouverte.
  Aucun état partagé avec une fenêtre : il fonctionne donc en terminal, en
  serveur, en CI.
- `superprint_pattern` **décrit** le motif dans l'objet (`_spMotif`) au lieu de
  dessiner des milliers de formes. Un consommateur qui sait lire cette clé le
  reproduit ; c'est ce que fait le contenu livré avec l'application.
- Il n'y a pas d'outil d'**export PDF** : l'export passe par le navigateur, qui
  possède le moteur de rendu. Un export serveur demanderait un moteur tiers.

---

## Licence

Voir `../LICENSE`. © Zigmoon — Simon Dupont-Gellert & Clémence Brunet.

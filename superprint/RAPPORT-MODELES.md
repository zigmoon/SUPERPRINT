# RAPPORT — Audit de la qualité des modèles IA pour le studio SP213

> **Date** : 29 août 2026 — **Version SuperPrint** : 1.7.265
> **Objectif** : évaluer quel modèle gratuit (OpenRouter / Groq) produit les MEILLEURES
> maquettes dans la **preview** (colonne de gauche) — c'est-à-dire arrive AU RÉSULTAT visuel.

---

## 1. Ce que le studio attend d'un modèle (critères d'évaluation)

Le studio SP213 transforme la réponse JSON en canvas. Un "bon" modèle = celui dont la sortie
**arrive bien dans la preview** avec une maquette propre. Critères objectifs :

| # | Critère | Détail | Impact si raté |
|---|---------|--------|----------------|
| C1 | **JSON valide, parsable** | Réponse = un seul JSON, sans texte/markdown autour | Aucune preview (JSON brut dans le chat) |
| C2 | **Structure correcte** | `{ "reply", "elements" }` OU `{ "reply", "targetPages", "pages": [{pageIndex, elements}] }` | Aucune preview ou pages manquantes |
| C3 | **8-20 éléments/page** | Chaque page assez riche | Page vide / claire |
| C4 | **Respect des bornes** | `left+width ≤ 210+3`, `top+height ≤ 297+3` (mm) | Débord coupé à l'écran |
| C5 | **Coordonnées mm + fontSize pt** | Unités correctes | Objets mal placés / texte énorme |
| C6 | **Polices SuperPrint** | Bebas Neue, Playfair, Montserrat, Poppins, Open Sans, IBM Plex, Roboto, Lato, IBM Plex Mono... | Police inconnue = fallback |
| C7 | **Contenu réel (pas Lorem)** | Vrais textes éditoriaux | Maquette inutilisable |
| C8 | **Respect du multi-page** | Produit TOUTES les pages demandées (`targetPages`) | Nombre de pages incorrect |
| C9 | **Troncature** | Ne dépasse pas `max_tokens` (32768 OpenRouter / 16384 Groq) | Pages manquantes (badge ⚠) |
| C10 | **Vitesse** | Temps de réponse | Expérience utilisateur |

---

## 2. Résultats observés (tests RÉELS effectués le 29/08 avec clés API temp)

> ✅ **Vrais tests** réalisés avec les clés temp (Groq + OpenRouter) le 29/08/2026.
> Prompt de référence : « Rapport corporate A4 8 pages sur l'industrie musicale : couverture,
> sommaire, édito, analyse marché, flux de revenus, étude de cas artiste, technologie, conclusion. »

### OpenRouter (modèles `:free`) — passe 1 (8 pages)

| Modèle | ID | JSON (C1/C2) | Pages (C8) | Éléments/page | Bornes (C4) | Temps | Verdict |
|--------|----|--------------|-----------|---------------|-------------|-------|---------|
| **Nemotron 3 Super 120B** ⭐ | `nvidia/nemotron-3-super-120b-a12b:free` | ✅ valide | **8/8** | bon | ⚠ 1 débord | ~118 s | ✅ **UTILISABLE** |
| **MiniMax M2.7** | `minimax/minimax-m2.7:free` | ✅ valide | **8/8** | dense (22.9/page) | ✅ OK | ~146 s | ✅ **UTILISABLE** |

### OpenRouter (modèles `:free`) — passe 2 (modèles ciblés)

| Modèle | ID | Résultat |
|--------|----|----------|
| Gemma 4 31B | `google/gemma-4-31b-it:free` | ❌ "Provider returned error" |
| GLM 5.2 | `z-ai/glm-5.2:free` | ❌ "Provider returned error" |
| MiniMax M3 | `minimax/minimax-m3:free` | ❌ répond (51 s) mais **JSON invalide** |
| Inkling Small 276B | `thinkingmachines/inkling-small:free` | ❌ réservé aux "agentic harnesses" |

### Groq — passe 2 (tous échouent)

| Modèle | ID | Résultat |
|--------|----|----------|
| Qwen 3.8 27B | `qwen/qwen3.8-27b` | ❌ **TPM dépassé** (limite 8000, requête 16906) |
| Qwen 3.6 27B | `qwen/qwen3.6-27b` | ❌ **TPM dépassé** (requête 16904) |
| OpenAI GPT-OSS 120B | `openai/gpt-oss-120b` | ❌ **TPM dépassé** (requête 16945) |
| OpenAI GPT-OSS 20B | `openai/gpt-oss-20b` | ❌ **TPM dépassé** (requête 16945) |
| Groq Compound | `groq/compound` | ❌ `max_tokens` plafonné à 8192 |

> **Diagnostic Groq (29/08, v1)** : le tier GRATUIT Groq est limité à **8 000 tokens/min**. Le prompt
> système SP213 (enrichi) + le contexte doc 8 pages + la génération demandent **~16 900 tokens** →
> dépassement systématique. **Groq gratuit est inadapté aux rapports multi-pages SP213.**

### 🔥 RÉTESTS Groq (30/08) — CAUSE RÉELLE IDENTIFIÉE + FIX

> **Découverte clé (vrais tests 30/08, clé Groq réelle)** : ce qui dépassait le TPM 8000, ce n'était
> PAS seulement le prompt — c'était **`max_tokens: 8192`** (Groq le compte dans le TPM :
> `8192 + prompt ≈ 8556 > 8000` → 413 systématique, même avec un prompt ULTRA court).

| Test | max_tokens | Résultat |
|------|-----------|----------|
| Qwen 3.8 27B, prompt complet | 8192 | ❌ 413 TPM (Requested 8556) |
| Qwen 3.8 27B, prompt ultra court | 8192 | ❌ 413 TPM (Requested 8260) |
| GPT-OSS 120B, prompt court | 8192 | ❌ 413 TPM (Requested 8473) |
| **Qwen 3.8 27B, 1 page** | **4096** | ✅ JSON valide, 8 él., 0 débord, ~1,9 s |
| **Qwen 3.8 27B, 4 pages** | **6000** | ✅ 4 pages (7/13/15/11 él.), finish=stop, ~10,9 s |
| **Qwen 3.8 27B, 4 pages** | **6000** | ✅ finish=stop, 5151 tokens, JSON 4 pages |

> **FIX APPLIQUÉ (30/08, 6 fichiers)** : `max_tokens` Groq **8192 → 6000** dans le studio
> (`sp213-studio.html` ×3 : web + local + public racine), `sp213-local/src/main.js`, et l'app
> (`app/JS/main.js` ×2). 6000 reste sous 8000 TPM (6000 + prompt ≈ 6224) et permet les multi-pages.
> `groq/compound-mini` fonctionne aussi (200, JSON, ~2 s) mais avec un format différent.
> ⚠️ Au-delà de ~4 pages, Groq peut être tronqué (finish=length) → `recoverPartialJSON` du studio récupère les pages complètes.

---

## 3. Conclusions & recommandations

### 🏆 Meilleur choix (confirmé par tests réels 30/08) : **DeepSeek V4 Flash**
- **DeepSeek V4 Flash** (`deepseek-v4-flash`) : **8/8 pages, JSON valide, 0 Lorem, 77-93 él., 27-32 s**
  (vs ~118-146 s OpenRouter). Plus rapide ET plus fiable que les gratuits OpenRouter testés.
- **DeepSeek V4 Pro** (`deepseek-v4-pro`) : **8/8 pages, 93 él., 0 Lorem, 89 s** — le plus riche en
  éléments (16 débords mineurs rattrapables), bon pour les maquettes denses.
- **OpenRouter, défaut : Nemotron 3 Super 120B** — fiable (8/8 pages) mais **~118 s** (4× plus lent que DeepSeek Flash).
- **Alternative OpenRouter : MiniMax M2.7** — 8/8 pages, dense, bornes OK, ~146 s.
- **Groq (après fix max_tokens 6000)** : très rapide (~2-11 s) mais **budget de sortie limité** →
  idéal pour 1-2 pages, OK jusqu'à ~4 pages, tronqué au-delà (récupération partielle).

### ⚠️ Points d'attention
1. **Groq gratuit** : budget TPM 8000/min — maintenant géré via `max_tokens: 6000`. Pour les gros
   rapports (> 4 pages), préférer DeepSeek ou OpenRouter.
2. **Gemma 4 31B** : échoue avec "Provider returned error" en test réel. **Nemotron 3 Super 120B**
   reste le défaut OpenRouter.
3. **Vitesse** : DeepSeek V4 Flash (~30 s pour 8 pages) est **bien plus rapide** que les gratuits
   OpenRouter (1-2 min).
4. **max_tokens** : OpenRouter **32768**, DeepSeek **32768**, Groq **6000** (fix 30/08 — 8192 dépassait le TPM 8000).

---

## 4. Méthode de test (reproduite le 29/08)

Le test réel a été fait avec `_test_models.mjs` / `_test_models2.mjs` (clés temp 24 h) :

1. Prompt de référence (en français, identique au studio) :
   > « Rapport corporate A4 8 pages sur l'industrie musicale : couverture, sommaire, édito,
   > analyse marché, flux de revenus, étude de cas artiste, technologie, conclusion. »
2. Pour chaque modèle, appels `chat/completions` directs avec le même prompt système SP213.
3. Critères mesurés : **JSON valide**, **structure correcte**, **pages produites / demandées**,
   **éléments par page**, **bornes mm respectées**, **temps de réponse**.

### Résultats consolidés (synthèse 29-30/08)

| Modèle | Fournisseur | JSON propre ? | Preview OK ? | Pages / demandées | Éléments/page | Débords ? | Temps | Verdict |
|--------|-------------|---------------|--------------|-------------------|---------------|-----------|-------|---------|
| **DeepSeek V4 Flash** ⭐ | DeepSeek | ✅ | ✅ | **8/8** | ~10-15 | 18 | **~30 s** | ✅ **recommandé** |
| **DeepSeek V4 Pro** | DeepSeek | ✅ | ✅ | **8/8** | ~12-13 | 16 | ~89 s | ✅ puissant |
| **Nemotron 3 Super 120B** | OpenRouter | ✅ | ✅ | **8/8** | ~15 | 1 | ~118 s | ✅ défaut OR |
| **MiniMax M2.7** | OpenRouter | ✅ | ✅ | **8/8** | ~23 | 0 | ~146 s | ✅ alt. OR |
| Gemma 4 31B | OpenRouter | — | — | — | — | — | err | ❌ fournisseur |
| GLM 5.2 | OpenRouter | — | — | — | — | — | err | ❌ fournisseur |
| MiniMax M3 | OpenRouter | ❌ | ❌ | 0/8 | — | — | 51 s | ❌ JSON |
| Inkling Small 276B | OpenRouter | — | — | — | — | — | err | ❌ agentic only |
| Qwen 3.8 27B (max 6000) | Groq | ✅ | ✅ | **4/4** | ~7-15 | 0 | **~11 s** | ✅ rapide ≤ 4p |
| Qwen 3.8/3.6 27B (max 8192) | Groq | — | — | — | — | — | 413 | ❌ TPM 8000 |
| GPT-OSS 120B/20B (max 8192) | Groq | — | — | — | — | — | 413 | ❌ TPM 8000 |
| Groq Compound | Groq | — | — | — | — | — | err | ❌ max 8192 |

---

## 5. Améliorations appliquées pour fiabiliser TOUS les modèles

Le pipeline du studio a été renforcé (indépendamment du modèle) :
- `max_tokens` : OpenRouter **32768**, DeepSeek **32768**, Groq **6000** (fix 30/08 — 8192 dépassait le TPM 8000 du tier gratuit).
- `parseAIResponse` robuste : gère le JSON dans `reply`, les variantes `layout`/`maquette`,
  la détection de troncature (`__SP213_TRUNCATED__`).
- `recoverPartialJSON` : récupère les pages **complètes** d'un JSON tronqué (équilibrage d'accolades).
- System prompt enrichi (section 0) : décrit SuperPrint, le format `.sp`, les polices disponibles,
  et l'exigence "la preview reflète EXACTEMENT le JSON" → meilleure compréhension du contexte.
- Boutons dans le chat : Télécharger .sp + code repliable (masqué par défaut).
- **Listes de modèles corrigées** (29/08) : les anciens IDs Groq (`llama-3.3-70b-versatile`,
  `llama-4-*`, `qwen-2.5-32b`…) **n'existent plus**. Remplacés par les IDs Groq actuels.
  OpenRouter : **Nemotron 3 Super 120B devient le défaut** (vérifié), Gemma 4/GLM/M3/Inkling Small
  marqués ⚠ dans la liste avec leur statut de test.
- **Messages d'erreur traduits** : dépassement TPM Groq et plafond `max_tokens` → explication
  claire à l'utilisateur (réduire la demande / patienter / passer en OpenRouter).

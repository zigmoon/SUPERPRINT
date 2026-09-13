# SuperPrint 1.7.380 — ce qui change pour vous

**En une phrase :** le texte de vos blocs se coupe maintenant correctement, en
français comme en anglais, et vos PDF ressemblent exactement à ce que vous voyez
à l'écran.

---

## 1. La césure parle enfin votre langue

**Avant**, quelle que soit la langue dans laquelle vous écriviez, l'application
utilisait les règles du **français**. Si vous rédigiez en anglais, les mots
étaient coupés de travers — et rien ne vous le signalait.

Quelques exemples réels :

| Vous écriviez | L'application coupait | Il fallait |
|---|---|---|
| printing | `prin-ting` | `print-ing` |
| hyphenation | `hy-phe-na-tion` | `hy-phen-ation` |
| professional | `pro-fes-sio-nal` | `pro-fes-sional` |
| layout | *(rien)* | `lay-out` |

**Maintenant**, la langue de césure suit la langue de votre interface. Vous
écrivez en anglais, l'anglais s'applique. En français, le français.

Si vous voulez choisir vous-même, le réglage existe toujours — et votre choix
l'emporte sur tout le reste.

---

## 2. Plus jamais « L'- »

**Avant**, le mot « L'habillage » pouvait se couper ainsi :

```
L'-
habillage
```

Ce n'est pas correct. En français, on ne coupe **jamais** juste après une
apostrophe : `l'`, `d'`, `qu'`, `n'`, `j'`, `s'`, `c'`, `m'`, `t'`. L'apostrophe
montre déjà où le mot se sépare.

**Maintenant**, la coupe respecte cette règle :

```
L'ha-
billage
```

Nous avons vérifié **1 571 coupures** sur des dizaines de combinaisons de
polices, de largeurs de colonne et de tailles de texte : plus une seule n'est
fautive.

---

## 3. Le tiret ne mord plus dans le mot

**Avant**, sur une ligne justifiée, le tiret de césure se posait **par-dessus**
la fin du mot — comme si on l'avait écrit trop à gauche. Cela venait d'un écart
entre ce que l'application affichait et ce qu'elle envoyait au PDF.

**Maintenant**, le tiret se place proprement **juste après** le dernier
caractère, dans la marge, comme dans un logiciel de PAO.

---

## 4. Votre réglage « sans césure » est respecté

**Avant**, si vous laissiez un bloc de texte volontairement **sans césure**, le
PDF exporté pouvait quand même le couper — avec des retours à la ligne différents
de ce que vous voyiez.

**Maintenant**, ce que vous décidez est ce qui est exporté.

---

## 5. Gras, italique, couleur : les blocs mélangés s'exportent correctement

**Avant**, si dans un même bloc vous mettiez une phrase **en gras**, une autre
*en italique*, une troisième en couleur et une quatrième dans une autre police,
l'export perdait l'alignement justifié de la ligne — et le tiret de césure
pouvait se retrouver **au milieu de la ligne**.

**Maintenant**, ces blocs se comportent exactement comme les blocs simples.

---

## 6. Vous êtes prévenu si du texte est caché

C'est un point nouveau, et il compte pour l'impression.

Un bloc de texte a une hauteur. Si vous y mettez plus de texte qu'il n'en peut
afficher, **le surplus est masqué** — c'est normal, c'est ainsi que fonctionnent
les logiciels de mise en page. Mais **rien ne vous le disait**.

**Maintenant**, à la fin d'un export, un message vous prévient :

> ⚠ 3 blocs texte masquent 14 lignes : agrandissez le bloc ou réduisez le texte

Vous savez donc, **avant d'envoyer à l'impression**, s'il reste du texte que vous
ne voyez pas.

---

## 7. L'export PDF vectoriel fonctionne à nouveau

L'application refusait parfois l'export en typographie vectorielle en annonçant
une police manquante. La police en question n'existait pas : c'était un nom
technique pris par erreur pour une police. C'est réparé.

**Rappel utile :** l'export vectoriel produit un PDF où le texte reste **du
texte** — sélectionnable, cherchable, net à n'importe quel agrandissement. C'est
ce qu'il faut pour l'imprimerie.

---

## 8. Petit changement sur la page d'accueil

L'entrée du studio s'appelle désormais simplement **« Studio »**, comme les
autres entrées de la liste.

---

## Ce que nous avons vérifié

Pour cette version, nous avons monté un document de test complet et regardé le
PDF exporté **ligne par ligne** :

- 3 pages : texte justifié, texte non justifié, styles mélangés dans un même
  bloc, texte **chaîné** sur deux blocs, texte **habillé autour d'un cercle**,
  texte habillé autour d'un rectangle
- Export en typographie vectorielle
- Résultat : **3 pages**, **zéro image** (donc du texte 100 % vectoriel),
  **13 césures** toutes correctement collées à leur mot, **aucune ligne qui
  dépasse son cadre**
- Le texte chaîné a restitué **ses 853 caractères**, sans en perdre un seul

---

## En résumé

**Vos mots se coupent correctement, vos PDF disent la vérité, et vous êtes
prévenu quand quelque chose cloche.**

C'était le cœur du travail de cette version : la césure est un détail qui ne se
voit pas quand elle est juste — et qui saute aux yeux quand elle est fausse.

---

*Version 1.7.380 — 13 septembre 2026*

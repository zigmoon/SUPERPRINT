/* ══════════════════════════════════════════════════════════════════════════════════════════════
   swatchbooks.js — SuperPrint 1.7.525
   NUANCIERS DE LA COLONNE DE DROITE (tons directs)

   Ce fichier remplace la longue liste déroulante « -- Sélectionner un Pantone -- » par une
   liste d'ACCORDÉONS : un nuancier par ligne (Toyo Color Finder, Focoltone, HKS, RAL, NCS,
   DIC, Pantone), qu'on ouvre pour choisir une couleur, pastille à l'appui.

   ⚠️ INTÉGRATION AVEC LE RESTE DE L'APP — RIEN N'EST DUPLIQUÉ :
   · le <select id="spotColorSelect"> reste dans index.html (masqué) et reste LA SOURCE DE
     VÉRITÉ du catalogue : _spSpotBuildCatalog(), _spSpotScanDocument() et l'export des
     couches « tons directs » lisent ses <option>. Ce module ne fait que LUI AJOUTER des
     <optgroup> (un par nuancier) ;
   · choisir une pastille écrit la valeur dans ce <select> puis déclenche un vrai `change` :
     c'est le gestionnaire de main.js qui applique l'encre, marque l'objet (_spSpotInk) et
     met à jour les sliders CMJN. Aucune logique d'application n'est réécrite ici ;
   · les fichiers .ase (Adobe Swatch Exchange) importés par l'utilisateur sont analysés
     localement (aucun envoi réseau) et deviennent un nuancier de la liste, conservé d'une
     session à l'autre (localStorage).

   Valeurs sRGB : les bibliothèques livrées ici sont des références d'APERÇU écran
   (approximations sRGB publiées), pas les bibliothèques officielles — c'est écrit sous la
   liste dans l'interface. Pour les valeurs exactes d'un fabricant, importer son .ase.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var NUMERO = '1.7.525';
    var LS_KEY = 'sp_swatch_imported_v1';
    var LS_MAX = 400000;                 // garde-fou : on n'écrase pas le quota localStorage

    /* ─────────────────────────────── NUANCIERS LIVRÉS ───────────────────────────────
       colors : [ « Nom affiché dans l'accordéon », « #RRGGBB » ]
       Les groupes servent de repères dans l'accordéon ; dans le <select> masqué, chaque
       nuancier devient UN <optgroup> (label = nom du nuancier), donc `group` reste lisible
       pour le module d'export.                                                            */

    var BOOKS = [
        {
            id: 'toyo', name: 'Toyo Color Finder', groups: [
                { label: 'Jaunes & oranges', colors: [
                    ['Toyo 001 — Jaune pâle', '#F7E7A0'],
                    ['Toyo 002 — Jaune', '#F5DC4E'],
                    ['Toyo 003 — Jaune vif', '#F2C200'],
                    ['Toyo 004 — Jaune orangé', '#F5A70A'],
                    ['Toyo 005 — Orange pâle', '#F9B96B'],
                    ['Toyo 006 — Orange', '#F5810B'],
                    ['Toyo 007 — Orange soutenu', '#EE6411'],
                    ['Toyo 008 — Orange rouge', '#E8491D'],
                    ['Toyo 009 — Vermillon', '#DE3B18']
                ]},
                { label: 'Rouges & roses', colors: [
                    ['Toyo 010 — Écarlate', '#D62B24'],
                    ['Toyo 011 — Rouge', '#C8102E'],
                    ['Toyo 012 — Rouge profond', '#A6142B'],
                    ['Toyo 013 — Carmin', '#B32046'],
                    ['Toyo 014 — Crimson', '#9C1F3E'],
                    ['Toyo 015 — Bordeaux', '#6E1A2C'],
                    ['Toyo 016 — Rose pâle', '#F6C6D0'],
                    ['Toyo 017 — Rose', '#EE8FA8'],
                    ['Toyo 018 — Rose vif', '#E45C93'],
                    ['Toyo 019 — Magenta', '#D6006E']
                ]},
                { label: 'Violets', colors: [
                    ['Toyo 020 — Pourpre', '#8A2A86'],
                    ['Toyo 021 — Violet', '#6A2C8F'],
                    ['Toyo 022 — Violet bleuté', '#4F2C8B']
                ]},
                { label: 'Bleus & cyans', colors: [
                    ['Toyo 023 — Bleu pâle', '#A9CDE8'],
                    ['Toyo 024 — Bleu ciel', '#6FAED9'],
                    ['Toyo 025 — Bleu clair', '#3E8FC4'],
                    ['Toyo 026 — Bleu', '#1666AC'],
                    ['Toyo 027 — Bleu profond', '#0E4C86'],
                    ['Toyo 028 — Marine', '#0B2B4F'],
                    ['Toyo 029 — Cyan', '#00A0C6'],
                    ['Toyo 030 — Turquoise', '#00A9A0']
                ]},
                { label: 'Verts', colors: [
                    ['Toyo 031 — Vert d’eau', '#00796B'],
                    ['Toyo 032 — Vert pâle', '#C6E5A8'],
                    ['Toyo 033 — Vert clair', '#8CC63F'],
                    ['Toyo 034 — Vert', '#3BA13B'],
                    ['Toyo 035 — Vert soutenu', '#1D7A38'],
                    ['Toyo 036 — Vert foncé', '#0E5A2E'],
                    ['Toyo 037 — Olive', '#7E8C3A'],
                    ['Toyo 038 — Kaki', '#B0A264']
                ]},
                { label: 'Bruns & neutres', colors: [
                    ['Toyo 039 — Brun clair', '#C29A6B'],
                    ['Toyo 040 — Brun', '#8B5A2B'],
                    ['Toyo 041 — Brun foncé', '#5E3A1E'],
                    ['Toyo 042 — Gris 20 %', '#CCCCCC'],
                    ['Toyo 043 — Gris 50 %', '#808080'],
                    ['Toyo 044 — Gris 80 %', '#333333'],
                    ['Toyo 045 — Noir', '#1A1A1A'],
                    ['Toyo 046 — Blanc cassé', '#F5F3EA']
                ]}
            ]
        },
        {
            id: 'focoltone', name: 'Focoltone', groups: [
                { label: 'Jaunes & oranges', colors: [
                    ['Focoltone 1001 — Jaune clair', '#FCE883'],
                    ['Focoltone 1002 — Jaune', '#F7D117'],
                    ['Focoltone 1003 — Jaune d’or', '#EFB000'],
                    ['Focoltone 1004 — Curcuma', '#E09B0E'],
                    ['Focoltone 1005 — Ambre', '#D98C00'],
                    ['Focoltone 1006 — Orange clair', '#FBB040'],
                    ['Focoltone 1007 — Orange', '#F5811F'],
                    ['Focoltone 1008 — Orange brûlé', '#D2621B'],
                    ['Focoltone 1009 — Terracotta', '#B85C29']
                ]},
                { label: 'Rouges & roses', colors: [
                    ['Focoltone 1010 — Corail', '#F26D5B'],
                    ['Focoltone 1011 — Rouge clair', '#E22B29'],
                    ['Focoltone 1012 — Rouge', '#CE1126'],
                    ['Focoltone 1013 — Rouge profond', '#A5181F'],
                    ['Focoltone 1014 — Bordeaux', '#74172B'],
                    ['Focoltone 1015 — Rouge rosé', '#D5325A'],
                    ['Focoltone 1016 — Rose', '#EC6E9C'],
                    ['Focoltone 1017 — Rose clair', '#F7A8C4'],
                    ['Focoltone 1018 — Magenta', '#D6006E'],
                    ['Focoltone 1019 — Fuchsia', '#B5197F']
                ]},
                { label: 'Violets', colors: [
                    ['Focoltone 1020 — Violet clair', '#9C6BB5'],
                    ['Focoltone 1021 — Violet', '#6D3E9E'],
                    ['Focoltone 1022 — Violet profond', '#4B2C7F'],
                    ['Focoltone 1023 — Aubergine', '#3B2351']
                ]},
                { label: 'Bleus & cyans', colors: [
                    ['Focoltone 1024 — Bleu très clair', '#BBDDF2'],
                    ['Focoltone 1025 — Bleu clair', '#7FBEE4'],
                    ['Focoltone 1026 — Bleu ciel', '#3E92CC'],
                    ['Focoltone 1027 — Bleu', '#1B62A5'],
                    ['Focoltone 1028 — Bleu roi', '#123C7A'],
                    ['Focoltone 1029 — Bleu nuit', '#0E2447'],
                    ['Focoltone 1030 — Cyan', '#0097C9'],
                    ['Focoltone 1031 — Turquoise', '#00AAA5'],
                    ['Focoltone 1032 — Cyan foncé', '#00696F']
                ]},
                { label: 'Verts', colors: [
                    ['Focoltone 1033 — Vert menthe', '#BFE3CE'],
                    ['Focoltone 1034 — Vert clair', '#7CC576'],
                    ['Focoltone 1035 — Vert', '#3AA63C'],
                    ['Focoltone 1036 — Vert soutenu', '#1E7F3C'],
                    ['Focoltone 1037 — Vert bouteille', '#0F5B33'],
                    ['Focoltone 1038 — Vert anis', '#A8C33A'],
                    ['Focoltone 1039 — Olive', '#7B8A32']
                ]},
                { label: 'Bruns & neutres', colors: [
                    ['Focoltone 1040 — Sable', '#D9C39A'],
                    ['Focoltone 1041 — Brun clair', '#B98A55'],
                    ['Focoltone 1042 — Brun', '#7E5327'],
                    ['Focoltone 1043 — Marron', '#4E3320'],
                    ['Focoltone 1044 — Gris clair', '#D2D2D2'],
                    ['Focoltone 1045 — Gris', '#8C8C8C'],
                    ['Focoltone 1046 — Gris foncé', '#4A4A4A'],
                    ['Focoltone 1047 — Noir', '#161616'],
                    ['Focoltone 1048 — Blanc', '#FFFFFF']
                ]}
            ]
        },
        {
            id: 'hks', name: 'HKS', groups: [
                { label: 'Jaunes & oranges', colors: [
                    ['HKS 1 K — Jaune citron', '#F6E500'],
                    ['HKS 3 K — Jaune', '#FFD500'],
                    ['HKS 4 K — Jaune d’or', '#FFC300'],
                    ['HKS 5 K — Jaune orangé', '#FFB100'],
                    ['HKS 6 K — Orange clair', '#FFA000'],
                    ['HKS 7 K — Orange', '#FF8A00'],
                    ['HKS 8 K — Orange soutenu', '#F57C00'],
                    ['HKS 10 K — Orange rouge', '#F2620F'],
                    ['HKS 11 K — Mandarine', '#EE5A1B'],
                    ['HKS 12 K — Vermillon', '#E8412C']
                ]},
                { label: 'Rouges & roses', colors: [
                    ['HKS 13 K — Écarlate', '#E01A22'],
                    ['HKS 14 K — Rouge', '#D0021B'],
                    ['HKS 15 K — Rouge sombre', '#B2101F'],
                    ['HKS 17 K — Rouge carmin', '#A00E27'],
                    ['HKS 18 K — Carmin profond', '#8C1231'],
                    ['HKS 20 K — Bordeaux', '#6E1529'],
                    ['HKS 21 K — Rouge violet', '#8B1A4E'],
                    ['HKS 22 K — Framboise', '#B01C55'],
                    ['HKS 24 K — Rose', '#E2548E'],
                    ['HKS 25 K — Rose clair', '#F08CB4'],
                    ['HKS 26 K — Magenta', '#D4007A'],
                    ['HKS 27 K — Fuchsia', '#C2007B'],
                    ['HKS 28 K — Pourpre', '#8E1A80']
                ]},
                { label: 'Violets', colors: [
                    ['HKS 29 K — Violet', '#7A2A8C'],
                    ['HKS 30 K — Violet profond', '#5A2A7F'],
                    ['HKS 31 K — Violet bleuté', '#432C7A']
                ]},
                { label: 'Bleus & cyans', colors: [
                    ['HKS 33 K — Bleu clair', '#8FC2E8'],
                    ['HKS 34 K — Bleu ciel', '#4B9AD4'],
                    ['HKS 35 K — Bleu', '#1F76BE'],
                    ['HKS 36 K — Bleu soutenu', '#0B5FA5'],
                    ['HKS 37 K — Bleu profond', '#0A4C8B'],
                    ['HKS 38 K — Bleu roi', '#123C7A'],
                    ['HKS 39 K — Marine', '#12264F'],
                    ['HKS 40 K — Cyan', '#00A0CE'],
                    ['HKS 41 K — Cyan profond', '#0079A8'],
                    ['HKS 42 K — Turquoise', '#00A89A'],
                    ['HKS 43 K — Turquoise foncé', '#00776F']
                ]},
                { label: 'Verts', colors: [
                    ['HKS 44 K — Vert clair', '#96C93D'],
                    ['HKS 45 K — Vert', '#4CA82F'],
                    ['HKS 46 K — Vert soutenu', '#2E8B3D'],
                    ['HKS 47 K — Vert foncé', '#1B6B39'],
                    ['HKS 48 K — Vert bouteille', '#0E5533'],
                    ['HKS 49 K — Vert jaune', '#A8B92B'],
                    ['HKS 50 K — Olive', '#7A8A2E']
                ]},
                { label: 'Bruns & neutres', colors: [
                    ['HKS 53 K — Sable', '#D5C29A'],
                    ['HKS 55 K — Brun clair', '#B58A55'],
                    ['HKS 57 K — Brun', '#7C5527'],
                    ['HKS 60 K — Marron', '#4A3222'],
                    ['HKS 63 K — Gris clair', '#D6D6D6'],
                    ['HKS 65 K — Gris', '#949494'],
                    ['HKS 68 K — Gris foncé', '#555555'],
                    ['HKS 70 K — Anthracite', '#333333'],
                    ['HKS 75 K — Noir profond', '#111111'],
                    ['HKS 80 K — Blanc', '#FFFFFF']
                ]}
            ]
        },
        {
            id: 'ral', name: 'RAL', groups: [
                { label: 'Jaunes', colors: [
                    ['RAL 1000 — Vert-beige', '#CCC58F'],
                    ['RAL 1001 — Beige', '#D1BC8A'],
                    ['RAL 1002 — Jaune sable', '#D2B773'],
                    ['RAL 1003 — Jaune signalisation', '#F7BA0B'],
                    ['RAL 1004 — Jaune doré', '#E2B007'],
                    ['RAL 1005 — Jaune miel', '#C89F04'],
                    ['RAL 1006 — Jaune maïs', '#E1A100'],
                    ['RAL 1007 — Jaune narcisse', '#E79C00'],
                    ['RAL 1011 — Brun beige', '#AF8A54'],
                    ['RAL 1012 — Jaune citron', '#D9C022'],
                    ['RAL 1013 — Blanc perle', '#E9E5CE'],
                    ['RAL 1014 — Ivoire', '#DFCEA1'],
                    ['RAL 1015 — Ivoire clair', '#EADEBD'],
                    ['RAL 1016 — Jaune soufre', '#EAF044'],
                    ['RAL 1017 — Jaune safran', '#F4B752'],
                    ['RAL 1018 — Jaune zinc', '#F3E03B'],
                    ['RAL 1019 — Gris beige', '#A4957D'],
                    ['RAL 1020 — Jaune olive', '#9A9464'],
                    ['RAL 1021 — Jaune colza', '#EEC900'],
                    ['RAL 1023 — Jaune signalisation', '#F0CA00'],
                    ['RAL 1024 — Jaune ocre', '#B89C50'],
                    ['RAL 1027 — Jaune curry', '#A18515'],
                    ['RAL 1028 — Jaune melon', '#F5A300'],
                    ['RAL 1032 — Jaune genêt', '#E3A800'],
                    ['RAL 1033 — Jaune dahlia', '#F39B13'],
                    ['RAL 1034 — Jaune pastel', '#EFA100']
                ]},
                { label: 'Oranges', colors: [
                    ['RAL 2000 — Jaune orangé', '#ED760E'],
                    ['RAL 2001 — Rouge orangé', '#C93C20'],
                    ['RAL 2002 — Rouge vermillon', '#CB2821'],
                    ['RAL 2003 — Orange pastel', '#FF7514'],
                    ['RAL 2004 — Orange pur', '#F44611'],
                    ['RAL 2008 — Rouge orangé clair', '#F75E25'],
                    ['RAL 2009 — Orange signalisation', '#F54021'],
                    ['RAL 2010 — Orange signal', '#D84B20'],
                    ['RAL 2011 — Orange câble', '#EC7C26'],
                    ['RAL 2012 — Orange saumon', '#E55137']
                ]},
                { label: 'Rouges & roses', colors: [
                    ['RAL 3000 — Rouge feu', '#AF2B1E'],
                    ['RAL 3001 — Rouge signal', '#A52019'],
                    ['RAL 3002 — Rouge carmin', '#A2231D'],
                    ['RAL 3003 — Rouge rubis', '#9B111E'],
                    ['RAL 3004 — Rouge pourpre', '#75151E'],
                    ['RAL 3005 — Rouge vin', '#5E2129'],
                    ['RAL 3007 — Rouge noir', '#412227'],
                    ['RAL 3009 — Rouge oxyde', '#642424'],
                    ['RAL 3011 — Rouge brun', '#781F19'],
                    ['RAL 3012 — Rouge beige', '#C1876B'],
                    ['RAL 3013 — Rouge tomate', '#A12312'],
                    ['RAL 3014 — Vieux rose', '#D36E70'],
                    ['RAL 3015 — Rose clair', '#EA899A'],
                    ['RAL 3016 — Rouge corail', '#B4312E'],
                    ['RAL 3017 — Rose', '#C6394A'],
                    ['RAL 3018 — Rouge fraise', '#C82A54'],
                    ['RAL 3020 — Rouge signalisation', '#CC0605'],
                    ['RAL 3022 — Rouge saumon', '#D95D39'],
                    ['RAL 3027 — Rouge framboise', '#AB273C'],
                    ['RAL 3031 — Rouge oriental', '#A63437']
                ]},
                { label: 'Violets', colors: [
                    ['RAL 4001 — Lilas rouge', '#816183'],
                    ['RAL 4002 — Rouge violet', '#8D3C4B'],
                    ['RAL 4003 — Violet bruyère', '#C4618C'],
                    ['RAL 4004 — Violet bordeaux', '#651E38'],
                    ['RAL 4005 — Lilas bleu', '#76689A'],
                    ['RAL 4006 — Pourpre signalisation', '#903373'],
                    ['RAL 4007 — Violet pourpre', '#47243C'],
                    ['RAL 4008 — Violet signal', '#844C82'],
                    ['RAL 4009 — Violet pastel', '#9D8692'],
                    ['RAL 4010 — Telemagenta', '#BC4077']
                ]},
                { label: 'Bleus', colors: [
                    ['RAL 5000 — Bleu violet', '#2E3A87'],
                    ['RAL 5001 — Bleu vert', '#0E294B'],
                    ['RAL 5002 — Bleu outremer', '#20214F'],
                    ['RAL 5003 — Bleu saphir', '#1D1F2A'],
                    ['RAL 5004 — Bleu noir', '#191E28'],
                    ['RAL 5005 — Bleu signal', '#154889'],
                    ['RAL 5007 — Bleu brillant', '#41678D'],
                    ['RAL 5008 — Bleu gris', '#313C48'],
                    ['RAL 5009 — Bleu azur', '#2E5978'],
                    ['RAL 5010 — Bleu gentiane', '#13447C'],
                    ['RAL 5011 — Bleu acier', '#232C3F'],
                    ['RAL 5012 — Bleu clair', '#3481B8'],
                    ['RAL 5013 — Bleu cobalt', '#1C2B4A'],
                    ['RAL 5014 — Bleu pigeon', '#606E8C'],
                    ['RAL 5015 — Bleu ciel', '#2271B3'],
                    ['RAL 5017 — Bleu signalisation', '#063971'],
                    ['RAL 5018 — Bleu turquoise', '#3F888F'],
                    ['RAL 5019 — Bleu capri', '#1B5583'],
                    ['RAL 5020 — Bleu océan', '#1D334A'],
                    ['RAL 5021 — Bleu eau', '#256D7B'],
                    ['RAL 5022 — Bleu nuit', '#252850'],
                    ['RAL 5023 — Bleu distant', '#49678D'],
                    ['RAL 5024 — Bleu pastel', '#5D9B9B']
                ]},
                { label: 'Verts', colors: [
                    ['RAL 6000 — Vert patine', '#316650'],
                    ['RAL 6001 — Vert émeraude', '#287233'],
                    ['RAL 6002 — Vert feuille', '#2D572C'],
                    ['RAL 6003 — Vert olive', '#424632'],
                    ['RAL 6004 — Vert bleu', '#1F3A3D'],
                    ['RAL 6005 — Vert mousse', '#2F4538'],
                    ['RAL 6006 — Gris olive', '#3E3B32'],
                    ['RAL 6007 — Vert bouteille', '#343B29'],
                    ['RAL 6008 — Vert brun', '#39352A'],
                    ['RAL 6009 — Vert sapin', '#31372B'],
                    ['RAL 6010 — Vert gazon', '#35682D'],
                    ['RAL 6011 — Vert réséda', '#587246'],
                    ['RAL 6012 — Vert noir', '#343E40'],
                    ['RAL 6013 — Vert roseau', '#6C7156'],
                    ['RAL 6014 — Jaune olive', '#47402E'],
                    ['RAL 6015 — Olive noir', '#3B3C36'],
                    ['RAL 6016 — Vert turquoise', '#1E5945'],
                    ['RAL 6017 — Vert mai', '#4C9141'],
                    ['RAL 6018 — Vert jaune', '#57A639'],
                    ['RAL 6019 — Vert pastel', '#BDECB6'],
                    ['RAL 6020 — Vert chromé', '#2E3A23'],
                    ['RAL 6021 — Vert pâle', '#89AC76'],
                    ['RAL 6022 — Olive brun', '#25221B'],
                    ['RAL 6024 — Vert signalisation', '#308446'],
                    ['RAL 6025 — Vert fougère', '#3D642D'],
                    ['RAL 6026 — Vert opale', '#015D52'],
                    ['RAL 6027 — Vert clair', '#84C3BE'],
                    ['RAL 6028 — Vert pin', '#2C5545'],
                    ['RAL 6029 — Vert menthe', '#20603D'],
                    ['RAL 6032 — Vert signal', '#317F43'],
                    ['RAL 6033 — Turquoise menthe', '#497E76'],
                    ['RAL 6034 — Turquoise pastel', '#7FB5B5']
                ]},
                { label: 'Gris', colors: [
                    ['RAL 7000 — Gris petit-gris', '#78858B'],
                    ['RAL 7001 — Gris argent', '#8A9597'],
                    ['RAL 7002 — Gris olive', '#818069'],
                    ['RAL 7003 — Gris mousse', '#6C7059'],
                    ['RAL 7004 — Gris signal', '#969992'],
                    ['RAL 7005 — Gris souris', '#646B63'],
                    ['RAL 7006 — Gris beige', '#6D6552'],
                    ['RAL 7008 — Gris kaki', '#6A5F31'],
                    ['RAL 7009 — Gris vert', '#4D5645'],
                    ['RAL 7010 — Gris bâche', '#4C514A'],
                    ['RAL 7011 — Gris fer', '#434B4D'],
                    ['RAL 7012 — Gris basalte', '#4E5754'],
                    ['RAL 7013 — Gris brun', '#464531'],
                    ['RAL 7015 — Gris ardoise', '#434750'],
                    ['RAL 7016 — Gris anthracite', '#293133'],
                    ['RAL 7021 — Gris noir', '#23282B'],
                    ['RAL 7022 — Gris terre d’ombre', '#332F2C'],
                    ['RAL 7023 — Gris béton', '#686C5E'],
                    ['RAL 7024 — Gris graphite', '#474A51'],
                    ['RAL 7026 — Gris granit', '#2F353B'],
                    ['RAL 7030 — Gris pierre', '#8B8C7A'],
                    ['RAL 7031 — Gris bleu', '#474B4E'],
                    ['RAL 7032 — Gris caillou', '#B8B799'],
                    ['RAL 7033 — Gris ciment', '#7D8471'],
                    ['RAL 7034 — Gris jaune', '#8F8B66'],
                    ['RAL 7035 — Gris clair', '#D7D7D7'],
                    ['RAL 7036 — Gris platine', '#7F7679'],
                    ['RAL 7037 — Gris poussière', '#7D7F7D'],
                    ['RAL 7038 — Gris agate', '#B5B8B1'],
                    ['RAL 7039 — Gris quartz', '#6C6960'],
                    ['RAL 7040 — Gris fenêtre', '#9DA1AA'],
                    ['RAL 7042 — Gris signalisation A', '#8D948D'],
                    ['RAL 7043 — Gris signalisation B', '#4E5452'],
                    ['RAL 7044 — Gris soie', '#CAC4B0'],
                    ['RAL 7045 — Telegris 1', '#909090'],
                    ['RAL 7046 — Telegris 2', '#82898F'],
                    ['RAL 7047 — Telegris 4', '#D0D0D0']
                ]},
                { label: 'Bruns', colors: [
                    ['RAL 8000 — Brun vert', '#826C34'],
                    ['RAL 8001 — Brun ocre', '#955F20'],
                    ['RAL 8002 — Brun signal', '#6C3B2A'],
                    ['RAL 8003 — Brun argile', '#734222'],
                    ['RAL 8004 — Brun cuivre', '#8E402A'],
                    ['RAL 8007 — Brun faon', '#59351F'],
                    ['RAL 8008 — Brun olive', '#6F4F28'],
                    ['RAL 8011 — Brun noisette', '#5B3A29'],
                    ['RAL 8012 — Brun rouge', '#592321'],
                    ['RAL 8014 — Brun sépia', '#382C1E'],
                    ['RAL 8015 — Brun marron', '#633A34'],
                    ['RAL 8016 — Brun acajou', '#4C2F27'],
                    ['RAL 8017 — Brun chocolat', '#45322E'],
                    ['RAL 8019 — Brun gris', '#403A3A'],
                    ['RAL 8022 — Brun noir', '#212121'],
                    ['RAL 8023 — Brun orange', '#A65E2E'],
                    ['RAL 8024 — Brun beige', '#79553D'],
                    ['RAL 8025 — Brun pâle', '#755C48'],
                    ['RAL 8028 — Brun terre', '#4E3B31']
                ]},
                { label: 'Blancs & noirs', colors: [
                    ['RAL 9001 — Blanc crème', '#FDF4E3'],
                    ['RAL 9002 — Blanc gris', '#E7EBDA'],
                    ['RAL 9003 — Blanc signalisation', '#F4F4F4'],
                    ['RAL 9004 — Noir signalisation', '#282828'],
                    ['RAL 9005 — Noir foncé', '#0A0A0A'],
                    ['RAL 9006 — Aluminium blanc', '#A5A5A5'],
                    ['RAL 9007 — Aluminium gris', '#8F8F8F'],
                    ['RAL 9010 — Blanc pur', '#FFFFFF'],
                    ['RAL 9011 — Noir graphite', '#1C1C1C'],
                    ['RAL 9016 — Blanc signalisation', '#F6F6F6'],
                    ['RAL 9017 — Noir signalisation', '#1E1E1E'],
                    ['RAL 9018 — Blanc papyrus', '#CFD3CD'],
                    ['RAL 9022 — Gris perle clair', '#9C9C9C'],
                    ['RAL 9023 — Gris perle foncé', '#828282']
                ]}
            ]
        },
        {
            id: 'ncs', name: 'NCS', groups: [
                { label: 'Neutres (N)', colors: [
                    ['NCS S 0300-N', '#F7F7F5'],
                    ['NCS S 0500-N', '#F1F1EE'],
                    ['NCS S 1000-N', '#DDDDDA'],
                    ['NCS S 1500-N', '#C9C9C4'],
                    ['NCS S 2000-N', '#B6B6B0'],
                    ['NCS S 2500-N', '#A4A49D'],
                    ['NCS S 3000-N', '#929289'],
                    ['NCS S 3500-N', '#7F7F76'],
                    ['NCS S 4000-N', '#6E6E66'],
                    ['NCS S 4500-N', '#5F5F58'],
                    ['NCS S 5000-N', '#51514B'],
                    ['NCS S 5500-N', '#44443F'],
                    ['NCS S 6000-N', '#383833'],
                    ['NCS S 6500-N', '#2C2C28'],
                    ['NCS S 7000-N', '#232320'],
                    ['NCS S 8000-N', '#151513'],
                    ['NCS S 9000-N', '#0A0A0A']
                ]},
                { label: 'Jaunes (Y)', colors: [
                    ['NCS S 0502-Y', '#F3F0DC'],
                    ['NCS S 1002-Y', '#E7E1C0'],
                    ['NCS S 1502-Y', '#D6CEA9'],
                    ['NCS S 2002-Y', '#C4BA92'],
                    ['NCS S 2502-Y', '#B1A67C'],
                    ['NCS S 3502-Y', '#8F8460'],
                    ['NCS S 4502-Y', '#6B6248'],
                    ['NCS S 5502-Y', '#514A36']
                ]},
                { label: 'Oranges & ocres (Y-R)', colors: [
                    ['NCS S 0570-Y10R', '#FFC845'],
                    ['NCS S 1050-Y10R', '#E9A100'],
                    ['NCS S 2060-Y20R', '#E68B2B'],
                    ['NCS S 3005-Y20R', '#A08C6A'],
                    ['NCS S 4010-Y30R', '#8E7A55'],
                    ['NCS S 4050-Y20R', '#9E8250'],
                    ['NCS S 5005-Y20R', '#75663F'],
                    ['NCS S 6005-Y20R', '#574B2E']
                ]},
                { label: 'Rouges (Y90R / R)', colors: [
                    ['NCS S 1080-Y90R', '#C0272D'],
                    ['NCS S 1580-Y90R', '#B31A24'],
                    ['NCS S 2080-Y90R', '#A51822'],
                    ['NCS S 2570-R', '#B02A3C'],
                    ['NCS S 4050-R', '#8A3A3A'],
                    ['NCS S 4550-R80B', '#7C5A7E'],
                    ['NCS S 5040-R30B', '#6E3B62']
                ]},
                { label: 'Bleus (R90B / B)', colors: [
                    ['NCS S 1050-R90B', '#6FA8DC'],
                    ['NCS S 3050-R90B', '#3A6EA5'],
                    ['NCS S 2060-B', '#2E86C1'],
                    ['NCS S 4050-B', '#1F4E79'],
                    ['NCS S 5040-B', '#16324F']
                ]},
                { label: 'Cyans (B50G)', colors: [
                    ['NCS S 1050-B50G', '#8FD3D3'],
                    ['NCS S 2060-B50G', '#29A3A3'],
                    ['NCS S 3050-B50G', '#1F7A7A'],
                    ['NCS S 4050-B50G', '#145C5C']
                ]},
                { label: 'Verts (G)', colors: [
                    ['NCS S 1050-G', '#A8D08D'],
                    ['NCS S 2060-G', '#4CAF50'],
                    ['NCS S 3060-G', '#2E7D32'],
                    ['NCS S 4050-G', '#1B5E20'],
                    ['NCS S 3060-G10Y', '#3C7A2F'],
                    ['NCS S 4060-G30Y', '#2F6B34']
                ]}
            ]
        },
        {
            id: 'dic', name: 'DIC', groups: [
                { label: 'Jaunes & oranges', colors: [
                    ['DIC 1 — Jaune pâle', '#FFF2A8'],
                    ['DIC 2 — Jaune', '#FFE800'],
                    ['DIC 3 — Jaune d’or', '#FFD100'],
                    ['DIC 4 — Jaune orangé', '#FFC000'],
                    ['DIC 5 — Orange clair', '#FFAE1F'],
                    ['DIC 6 — Orange', '#FB9411'],
                    ['DIC 7 — Orange soutenu', '#F07C10'],
                    ['DIC 8 — Orange rouge', '#E9611B'],
                    ['DIC 9 — Mandarine', '#DE4B1C']
                ]},
                { label: 'Rouges & roses', colors: [
                    ['DIC 10 — Vermillon', '#D93A22'],
                    ['DIC 11 — Rouge', '#CC1122'],
                    ['DIC 12 — Rouge sombre', '#A9121F'],
                    ['DIC 13 — Carmin', '#B01030'],
                    ['DIC 14 — Bordeaux', '#76152C'],
                    ['DIC 15 — Rouge rosé', '#DB3A63'],
                    ['DIC 16 — Rose', '#EE7BA5'],
                    ['DIC 17 — Rose clair', '#F6B0C8'],
                    ['DIC 18 — Magenta', '#D20074'],
                    ['DIC 19 — Fuchsia', '#B8157E'],
                    ['DIC 20 — Pourpre', '#8E1A78']
                ]},
                { label: 'Violets', colors: [
                    ['DIC 21 — Violet clair', '#9B6BB8'],
                    ['DIC 22 — Violet', '#6C3E9E'],
                    ['DIC 23 — Violet profond', '#48297C'],
                    ['DIC 24 — Aubergine', '#38224E']
                ]},
                { label: 'Bleus & cyans', colors: [
                    ['DIC 25 — Bleu très clair', '#C3E1F2'],
                    ['DIC 26 — Bleu clair', '#7FBEE4'],
                    ['DIC 27 — Bleu ciel', '#3A92CC'],
                    ['DIC 28 — Bleu', '#1B62A5'],
                    ['DIC 29 — Bleu roi', '#10407F'],
                    ['DIC 30 — Marine', '#0E2447'],
                    ['DIC 31 — Cyan', '#0099CC'],
                    ['DIC 32 — Turquoise', '#00AAA0'],
                    ['DIC 33 — Bleu-vert foncé', '#00666E']
                ]},
                { label: 'Verts', colors: [
                    ['DIC 34 — Vert menthe', '#C2E6D0'],
                    ['DIC 35 — Vert clair', '#7FC97F'],
                    ['DIC 36 — Vert', '#3AA63C'],
                    ['DIC 37 — Vert soutenu', '#1E7F3C'],
                    ['DIC 38 — Vert foncé', '#0F5B33'],
                    ['DIC 39 — Vert anis', '#A8C33A'],
                    ['DIC 40 — Olive', '#7B8A32']
                ]},
                { label: 'Bruns & neutres', colors: [
                    ['DIC 41 — Sable', '#D9C39A'],
                    ['DIC 42 — Brun clair', '#B98A55'],
                    ['DIC 43 — Brun', '#7E5327'],
                    ['DIC 44 — Marron foncé', '#4E3320'],
                    ['DIC 45 — Gris clair', '#D2D2D2'],
                    ['DIC 46 — Gris', '#8C8C8C'],
                    ['DIC 47 — Gris foncé', '#4A4A4A'],
                    ['DIC 48 — Noir', '#171717'],
                    ['DIC 49 — Blanc', '#FFFFFF']
                ]}
            ]
        }
    ];

    /* ─────────────────────────────── OUTILS ─────────────────────────────── */

    function hexValide(h) {
        return /^#[0-9a-fA-F]{6}$/.test(String(h || '')) ? String(h).toUpperCase() : '';
    }

    function octet(n) {
        n = Math.round(Number(n));
        if (!isFinite(n)) n = 0;
        return Math.max(0, Math.min(255, n));
    }

    function hexDepuisRgb(r, g, b) {
        var h = function (v) { var s = octet(v).toString(16).toUpperCase(); return s.length < 2 ? '0' + s : s; };
        return '#' + h(r) + h(g) + h(b);
    }

    /* CMYK (0..1) → sRGB : conversion naïve (1-c)(1-k), comme le reste de l'app pour
       l'aperçu écran d'un ton direct. */
    function cmykVersHex(c, m, y, k) {
        return hexDepuisRgb(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
    }

    /* L*a*b* (D50) → sRGB. Approximation suffisante pour une pastille d'écran. */
    function labVersHex(L, a, b) {
        var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
        var f = function (t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
        var X = 0.9642 * f(fx), Y = 1.0 * f(fy), Z = 0.8249 * f(fz);
        var r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
        var g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z;
        var bl = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
        var gam = function (v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
        return hexDepuisRgb(255 * gam(r), 255 * gam(g), 255 * gam(bl));
    }

    /* ─────────────────────── LECTURE D'UN FICHIER .ASE ───────────────────────
       Format Adobe Swatch Exchange : en-tête « ASEF », version (2 × uint16),
       nombre de blocs (uint32), puis des blocs :
         uint16 type · uint32 longueur · données
       type 0x0001 = couleur, 0xC001 = début de groupe, 0xC002 = fin de groupe.
       Une couleur : uint16 longueur du nom · nom (UTF-16BE) · modèle (4 octets :
       « RGB », « CMYK », « LAB », « Gray ») · 3/4/1 flottants big-endian.
       La lecture se recale à chaque bloc grâce à la longueur déclarée : un bloc
       inconnu est sauté au lieu de faire dérailler la suite du fichier.        */
    function lireAse(buffer) {
        var vue = new DataView(buffer);
        var u8 = new Uint8Array(buffer);
        if (u8.length < 12) throw new Error('fichier trop court');
        var sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
        if (sig !== 'ASEF') throw new Error('signature ASEF absente');
        var nb = vue.getUint32(8, false);
        var pos = 12, couleurs = [];
        for (var i = 0; i < nb && pos + 6 <= u8.length; i++) {
            var type = vue.getUint16(pos, false);
            var longueur = vue.getUint32(pos + 2, false);
            var p = pos + 6, fin = pos + 6 + longueur;
            if (type === 0x0001) {
                try {
                    var nlen = vue.getUint16(p, false); p += 2;
                    var nom = '';
                    for (var c = 0; c < nlen; c++) { nom += String.fromCharCode(vue.getUint16(p, false)); p += 2; }
                    var modele = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]); p += 4;
                    var v1 = vue.getFloat32(p, false), v2 = vue.getFloat32(p + 4, false);
                    var v3 = vue.getFloat32(p + 8, false), v4 = (modele === 'CMYK') ? vue.getFloat32(p + 12, false) : 0;
                    var hex = '';
                    if (modele === 'RGB ') hex = hexDepuisRgb(v1 * 255, v2 * 255, v3 * 255);
                    else if (modele === 'CMYK') hex = cmykVersHex(v1, v2, v3, v4);
                    else if (modele === 'LAB ') hex = labVersHex(v1, v2, v3);
                    else if (modele === 'Gray') hex = hexDepuisRgb(v1 * 255, v1 * 255, v1 * 255);
                    if (hex) couleurs.push([String(nom || hex).trim() || hex, hex]);
                } catch (_) {}
            }
            pos = fin;
        }
        return couleurs;
    }

    /* ─────────────────────────── ÉTAT / REGISTRE ─────────────────────────── */

    var livres = BOOKS.map(function (b) {
        return { id: b.id, name: b.name, groups: b.groups, importe: false };
    });

    function couleursDe(livre) {
        var out = [];
        (livre.groups || []).forEach(function (g) { (g.colors || []).forEach(function (c) { out.push(c); }); });
        return out;
    }

    function livreParId(id) {
        for (var i = 0; i < livres.length; i++) if (livres[i].id === id) return livres[i];
        return null;
    }

    /* ─────────── ALIMENTATION DU <select> MASQUÉ (SOURCE DE VÉRITÉ) ─────────── */
    function ajouterAuSelect(livre) {
        var sel = document.getElementById('spotColorSelect');
        if (!sel) return;
        var ancien = sel.querySelector('optgroup[data-sp-book="' + livre.id + '"]');
        if (ancien) ancien.parentNode.removeChild(ancien);
        var og = document.createElement('optgroup');
        og.label = livre.name;
        og.setAttribute('data-sp-book', livre.id);
        couleursDe(livre).forEach(function (c) {
            var o = document.createElement('option');
            o.value = c[1];
            o.textContent = c[0];
            og.appendChild(o);
        });
        sel.appendChild(og);
    }

    function retirerDuSelect(id) {
        var sel = document.getElementById('spotColorSelect');
        if (!sel) return;
        var og = sel.querySelector('optgroup[data-sp-book="' + id + '"]');
        if (og) og.parentNode.removeChild(og);
    }

    /* ────────────────────────── APPLICATION D'UNE COULEUR ──────────────────────────
       On écrit la valeur dans le <select> puis on déclenche un vrai `change` : tout le
       travail (fond ou contour, sliders CMJN, marquage _spSpotInk, historique) reste
       dans le gestionnaire d'origine de main.js. */
    function appliquer(hex, nom, item) {
        hex = hexValide(hex);
        if (!hex) return false;
        var sel = document.getElementById('spotColorSelect');
        if (!sel) return false;
        var opt = null;
        for (var i = 0; i < sel.options.length; i++) {
            if (String(sel.options[i].value).toUpperCase() === hex) { opt = sel.options[i]; break; }
        }
        if (!opt) {
            var og2 = document.getElementById('spSwatchOrphelins');
            if (!og2) {
                og2 = document.createElement('optgroup');
                og2.label = 'Import';
                og2.id = 'spSwatchOrphelins';
                sel.appendChild(og2);
            }
            opt = document.createElement('option');
            opt.value = hex;
            opt.textContent = nom || hex;
            og2.appendChild(opt);
        }
        sel.value = opt.value;
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {
            try { sel.dispatchEvent(new Event('change')); } catch (__) {}
        }
        /* Repère visuel : la pastille choisie reste encadrée jusqu'au prochain choix. */
        try {
            var panneau = document.getElementById('swatchBookList');
            if (panneau) {
                Array.prototype.forEach.call(panneau.querySelectorAll('.swatch-item.is-active'), function (el) {
                    el.classList.remove('is-active');
                });
            }
            if (item) item.classList.add('is-active');
        } catch (_) {}
        return true;
    }
    window.__spSwatchAppliquer = appliquer;   // utilisé par les items (et par les tests)

    /* ─────────────────────────── PERSISTANCE DES IMPORTÉS ─────────────────────────── */
    function sauverImportes() {
        try {
            var part = livres.filter(function (l) { return l.importe; }).map(function (l) {
                var cols = [];
                (l.groups || []).forEach(function (g) { (g.colors || []).forEach(function (c) { cols.push(c); }); });
                return { name: l.name, colors: cols };
            });
            var txt = JSON.stringify(part);
            if (txt.length > LS_MAX) { console.warn('[nuanciers] import trop volumineux pour être conservé (' + txt.length + ' caractères)'); return; }
            localStorage.setItem(LS_KEY, txt);
        } catch (e) { console.warn('[nuanciers] sauvegarde impossible : ' + e.message); }
    }

    function restaurerImportes() {
        var txt = null;
        try { txt = localStorage.getItem(LS_KEY); } catch (_) { return; }
        if (!txt) return;
        try {
            JSON.parse(txt).forEach(function (b) {
                if (!b || !b.name || !b.colors || !b.colors.length) return;
                ajouterLivreImporte(b.name, b.colors, true);
            });
        } catch (e) { console.warn('[nuanciers] import conservé illisible : ' + e.message); }
    }

    /* ─────────────────────────────── RENDU DE L'UI ─────────────────────────────── */

    function creerItemCouleur(nom, hex) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch-item';
        b.setAttribute('data-hex', hex);
        b.title = nom + ' — ' + hex;
        var dot = document.createElement('span');
        dot.className = 'swatch-dot';
        dot.style.background = hex;
        var txt = document.createElement('span');
        txt.className = 'swatch-name';
        txt.textContent = nom;
        b.appendChild(dot);
        b.appendChild(txt);
        b.addEventListener('click', function () { appliquer(hex, nom, b); });
        return b;
    }

    function creerNuancier(livre) {
        var wrap = document.createElement('div');
        wrap.className = 'swatch-book';
        wrap.setAttribute('data-book', livre.id);

        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'swatch-book-head';
        head.setAttribute('aria-expanded', 'false');
        head.innerHTML = '<span class="swatch-book-chevron">▸</span>' +
                         '<span class="swatch-book-name"></span>' +
                         '<span class="swatch-book-count"></span>';
        head.querySelector('.swatch-book-name').textContent = livre.name;
        var cols = couleursDe(livre);
        head.querySelector('.swatch-book-count').textContent = cols.length;
        head.title = livre.name + ' — ' + cols.length + ' teintes';

        var corps = document.createElement('div');
        corps.className = 'swatch-book-body';
        (livre.groups || []).forEach(function (g) {
            if ((livre.groups || []).length > 1 && g.label) {
                var cap = document.createElement('div');
                cap.className = 'swatch-group-label';
                cap.textContent = g.label;
                corps.appendChild(cap);
            }
            (g.colors || []).forEach(function (c) { corps.appendChild(creerItemCouleur(c[0], c[1])); });
        });

        head.addEventListener('click', function () {
            var ouvert = wrap.classList.toggle('is-open');
            head.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
            /* _SP_ORDRE_526 : la liste n'est plus plafonnée (FILL / STROKE est passé
               au-dessus) → plus de classe « has-open ». On garde seulement le rappel de
               l'en-tête cliqué dans le champ de vision, utile si la colonne défile. */
            if (ouvert) { try { head.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
        });

        wrap.appendChild(head);
        wrap.appendChild(corps);

        if (livre.importe) {
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'swatch-book-remove';
            rm.innerHTML = '✕';
            rm.title = (window.__spSwatchTxt && window.__spSwatchTxt.retirer) || 'Retirer ce nuancier';
            rm.addEventListener('click', function (e) {
                e.stopPropagation();
                retirerLivre(livre.id);
            });
            head.appendChild(rm);
        }
        return wrap;
    }

    function rendreListe() {
        var liste = document.getElementById('swatchBookList');
        if (!liste) return;
        liste.innerHTML = '';
        livres.forEach(function (l) { liste.appendChild(creerNuancier(l)); });
    }

    /* ─────────────────────────── IMPORT / RETRAIT ─────────────────────────── */

    function ajouterLivreImporte(nom, couleurs, silencieux) {
        if (!couleurs || !couleurs.length) return null;
        var base = String(nom || 'Nuancier importé').replace(/\.ase$/i, '').trim() || 'Nuancier importé';
        var id = 'ase-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        var n = 2, idf = id;
        while (livreParId(idf)) { idf = id + '-' + (n++); }
        var livre = {
            id: idf,
            name: base,
            groups: [{ label: base, colors: couleurs }],
            importe: true
        };
        livres.splice(livres.findIndex(function (l) { return l.id === 'dic'; }) + 1, 0, livre);
        ajouterAuSelect(livre);
        rendreListe();
        if (!silencieux) sauverImportes();
        return livre;
    }

    function retirerLivre(id) {
        var livre = livreParId(id);
        if (!livre || !livre.importe) return;
        livres = livres.filter(function (l) { return l.id !== id; });
        retirerDuSelect(id);
        rendreListe();
        sauverImportes();
    }

    function importerFichier(file) {
        if (!file) return;
        var lecteur = new FileReader();
        lecteur.onload = function () {
            try {
                var couleurs = lireAse(lecteur.result);
                if (!couleurs.length) { alert('Aucune couleur lisible dans « ' + file.name + ' ». Le fichier est-il bien un .ase ?'); return; }
                ajouterLivreImporte(file.name, couleurs);
                console.log('[nuanciers] « ' + file.name +' » importé : ' + couleurs.length + ' teintes');
            } catch (e) {
                alert('Import impossible : ' + e.message);
            }
        };
        lecteur.onerror = function () { alert('Lecture du fichier impossible.'); };
        lecteur.readAsArrayBuffer(file);
    }

    /* ─────────────────────────────── INITIALISATION ─────────────────────────────── */
    function init() {
        if (window.__spSwatchInit) return;
        var liste = document.getElementById('swatchBookList');
        var sel = document.getElementById('spotColorSelect');
        if (!liste || !sel) return;
        window.__spSwatchInit = true;

        livres.forEach(ajouterAuSelect);
        rendreListe();
        restaurerImportes();

        var input = document.getElementById('swatchImportInput');
        var bouton = document.getElementById('swatchImportBtn');
        if (bouton && input) {
            bouton.addEventListener('click', function () { input.value = ''; input.click(); });
            input.addEventListener('change', function () {
                if (input.files && input.files[0]) importerFichier(input.files[0]);
            });
        }
    }

    /* Texte du bouton de retrait, selon la langue courante de l'app si disponible. */
    try {
        window.__spSwatchTxt = { retirer: 'Retirer ce nuancier' };
    } catch (_) {}

    window.SP_SwatchBooks = {
        version: NUMERO,
        books: function () { return livres; },
        colors: couleursDe,
        apply: appliquer,
        lireAse: lireAse,
        addImported: ajouterLivreImporte,
        remove: retirerLivre,
        importFile: importerFichier
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

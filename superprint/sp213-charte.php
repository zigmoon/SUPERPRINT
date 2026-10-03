<?php
/* ══════════════════════════════════════════════════════════════════════════════════════
   ⚠️ _SP_STUDIO_ROCK631q — PROXY DE CHARTE (demande utilisateur, 2026-10-03) :
   « dans le studio, si l'utilisateur met une URL dans le prompt avec ROCK, on pourrait
    extraire le logo, la charte en CSS et quelques photos depuis la home ».
   Voie retenue par l'utilisateur : CE FICHIER, hébergé à côté du studio.

   POURQUOI UN PROXY : le studio s'ouvre en `file://` ; dans ce contexte le navigateur REFUSE
   de lire un site distant (CORS). Aucun code JavaScript ne contourne ça proprement. Ce petit
   fichier fait donc la lecture côté serveur (là où il n'y a pas de CORS) et renvoie le HTML
   brut au studio, qui en extrait la charte (couleurs), le logo et les photos.
   La typographie n'est JAMAIS extraite : le studio n'envoie que des couleurs et des images.

   SÉCURITÉ (un proxy ouvert est une porte : on la garde étroite)
     · http/https uniquement ; redirections limitées et re-vérifiées à chaque saut ;
     · AUCUNE adresse privée, de rebouclage ou réservée (localhost, 10.x, 192.168.x, 169.254…)
       — sinon ce fichier deviendrait un moyen d'atteindre le réseau interne de l'hébergeur ;
     · 15 s de délai, 1,2 Mo de réponse au maximum ;
     · aucun cookie, aucun en-tête d'authentification transmis, aucune écriture sur disque ;
     · type de contenu vérifié (`text/html` uniquement), réponse marquée `noindex`.

   USAGE : POST /sp213-charte.php  (champ `u` = l'URL de la page d'accueil)
   RÉPONSE : { ok, urlFinale, html } en JSON.
   ══════════════════════════════════════════════════════════════════════════════════════ */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function refus(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'erreur' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

$brut = isset($_POST['u']) ? (string)$_POST['u'] : (isset($_GET['u']) ? (string)$_GET['u'] : '');
$brut = trim($brut);
if ($brut === '') refus('URL manquante.');
if (!preg_match('~^https?://~i', $brut)) $brut = 'https://' . $brut;
if (!filter_var($brut, FILTER_VALIDATE_URL)) refus('URL invalide.');

/* ── Lecture prudente : on valide CHAQUE saut, jamais seulement le premier ─────────────── */
function urlSure(string $u): bool {
    $p = parse_url($u);
    if (!$p || empty($p['host'])) return false;
    $scheme = strtolower((string)($p['scheme'] ?? ''));
    if ($scheme !== 'http' && $scheme !== 'https') return false;
    $host = strtolower(trim((string)$p['host'], "[] \t\n\r\0\x0B"));
    if ($host === '' || $host === 'localhost' || substr($host, -6) === '.local') return false;
    /* Une IP littérale est jugée tout de suite ; un nom est résolu puis jugé. */
    $ips = [];
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        $ok = @dns_get_record($host, DNS_A | DNS_AAAA);
        if (is_array($ok)) {
            foreach ($ok as $r) {
                if (!empty($r['ip'])) $ips[] = (string)$r['ip'];
                if (!empty($r['ipv6'])) $ips[] = (string)$r['ipv6'];
            }
        }
        if (!$ips) $ips[] = (string)@gethostbyname($host);
    }
    foreach ($ips as $ip) {
        if ($ip === '' || $ip === $host) continue;
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) return false;
    }
    return true;
}

$courante = $brut;
$corps = false;
$code = 0;
$type = '';
for ($saut = 0; $saut < 4; $saut++) {
    if (!urlSure($courante)) refus('Adresse refusée (réseau privé ou réservé).', 403);
    $ch = curl_init($courante);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERAGENT      => 'SuperPrint-Charte/1.0 (+https://superprint.cc)',
        CURLOPT_ENCODING       => '',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml'],
    ]);
    $corps = curl_exec($ch);
    $code  = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type  = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $loc   = (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);
    /* Redirection : on la SUIT À LA MAIN pour repasser par urlSure(). */
    if ($code >= 300 && $code < 400 && $loc !== '') {
        $courante = (strpos($loc, 'http') === 0)
            ? $loc
            : (rtrim($brut, '/') . '/' . ltrim($loc, '/'));
        continue;
    }
    break;
}

if ($corps === false || $code < 200 || $code >= 400) refus('Page inaccessible (code ' . $code . ').', 502);
if ($type !== '' && stripos($type, 'html') === false) refus('La page n\'est pas du HTML.', 415);
if (strlen((string)$corps) > 1200000) $corps = substr((string)$corps, 0, 1200000);

echo json_encode([
    'ok'        => true,
    'urlFinale' => $courante,
    'html'      => (string)$corps,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

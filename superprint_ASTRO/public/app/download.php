<?php
// download.php - Script de téléchargement forcé

// Liste des fichiers autorisés (uniquement les fichiers réellement présents sur le serveur)
$allowed_files = [
    'superprint.ico',
    'icon_256.png'
];

// Récupérer le nom du fichier
$file = isset($_GET['file']) ? basename($_GET['file']) : '';

// Vérifier si le fichier est autorisé
if (!in_array($file, $allowed_files)) {
    http_response_code(404);
    die('Fichier non trouvé');
}

// Chemin complet du fichier
$filepath = __DIR__ . '/' . $file;

// Vérifier si le fichier existe
if (!file_exists($filepath)) {
    http_response_code(404);
    die('Fichier non trouvé');
}

// Forcer le téléchargement
header('Content-Description: File Transfer');
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $file . '"');
header('Content-Transfer-Encoding: binary');
header('Expires: 0');
header('Cache-Control: must-revalidate');
header('Pragma: public');
header('Content-Length: ' . filesize($filepath));

// Nettoyer le buffer de sortie
ob_clean();
flush();

// Lire et envoyer le fichier
readfile($filepath);
exit;
?>

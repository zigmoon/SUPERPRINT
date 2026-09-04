<?php
// Simple AI proxy to avoid browser CORS and keep API keys off third-party origins.
// Supports Anthropic Messages API, OpenAI, and DeepSeek.
// IMPORTANT: For production, prefer storing API keys server-side instead of forwarding from the client.

// CORS preflight — origines autorisées (production + dev local)
$allowedOrigins = [
    'https://superprint.cc',
    'https://www.superprint.cc',
    'https://app.zigmoon.com',
    'https://www.app.zigmoon.com',
    'http://localhost',
    'http://127.0.0.1'
];
$requestOrigin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
$origin = in_array($requestOrigin, $allowedOrigins, true) ? $requestOrigin : $allowedOrigins[0];
// Fichier local ouvert en file:// ou origine absente (même-serveur) : renvoyer l'écho
if ($requestOrigin === '') { $origin = ''; }
header('Access-Control-Allow-Origin: ' . $origin);
header('Vary: Origin');
header('Access-Control-Allow-Credentials: false');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key, X-Anthropic-Version');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 🛡️ FIX 2026-04 : autoriser jusqu'à 200 s d'exécution PHP pour laisser le temps
//    aux longues générations IA (magazine multi-pages avec Claude Sonnet 4.5,
//    GPT-5, etc. qui peuvent dépasser 60 s avec 16-32k tokens en sortie).
@set_time_limit(200);
@ini_set('max_execution_time', '200');

// --- Body size cap (reject payloads larger than 128 KB) ---
$maxBodyBytes = 128 * 1024;
if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > $maxBodyBytes) {
    http_response_code(413);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'payload too large']);
    exit;
}

// --- Per-IP rate limit (file-based sliding window) ---
// 30 requests per minute per client IP.
$rateLimitMax    = 30;
$rateLimitWindow = 60;
$clientIp = isset($_SERVER['HTTP_X_FORWARDED_FOR'])
    ? trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0])
    : (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown');
$rateDir = sys_get_temp_dir() . '/sp_ai_rl';
if (!is_dir($rateDir)) { @mkdir($rateDir, 0700, true); }
$rateFile = $rateDir . '/' . hash('sha256', $clientIp);
$now = time();
$hits = [];
if (is_file($rateFile)) {
    $raw = @file_get_contents($rateFile);
    if ($raw) {
        $tmp = json_decode($raw, true);
        if (is_array($tmp)) { $hits = $tmp; }
    }
}
$hits = array_values(array_filter($hits, function($t) use ($now, $rateLimitWindow) {
    return is_numeric($t) && ($now - (int)$t) < $rateLimitWindow;
}));
if (count($hits) >= $rateLimitMax) {
    http_response_code(429);
    header('Content-Type: application/json');
    header('Retry-After: ' . $rateLimitWindow);
    echo json_encode(['error' => 'rate limit exceeded', 'retryAfter' => $rateLimitWindow]);
    exit;
}
$hits[] = $now;
@file_put_contents($rateFile, json_encode($hits), LOCK_EX);

$provider = isset($_GET['provider']) ? $_GET['provider'] : '';
$body = file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);
if (strlen($body) > $maxBodyBytes) {
    http_response_code(413);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'payload too large']);
    exit;
}
$json = null;
if ($body) {
    $tmp = json_decode($body, true);
    if (is_array($tmp)) { $json = $tmp; }
}
if (!$provider) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'missing provider']);
    exit;
}

if ($provider === 'anthropic') {
    // Prefer headers but allow API key in JSON body to avoid client header encoding issues
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    $version = isset($_SERVER['HTTP_X_ANTHROPIC_VERSION']) ? $_SERVER['HTTP_X_ANTHROPIC_VERSION'] : '';
    if (!$apiKey && $json && isset($json['apiKey'])) {
        $apiKey = $json['apiKey'];
    }
    if (!$version && $json && isset($json['anthropicVersion'])) {
        $version = $json['anthropicVersion'];
    }
    if (!$version) { $version = '2023-06-01'; }
    if (!$apiKey) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'missing apiKey']);
        exit;
    }
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey,
        'anthropic-version: ' . $version
    ]);
    // Remove proxy-only fields from body if present
    $forwardBody = $body;
    if ($json !== null) {
        unset($json['apiKey']);
        unset($json['anthropicVersion']);
        $forwardBody = json_encode($json);
    }
    curl_setopt($ch, CURLOPT_POSTFIELDS, $forwardBody);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180); // 🛡️ 2026-04 : 60 → 180 s pour longues générations IA

    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl failed', 'detail' => $err]);
        exit;
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $respHeaders = substr($resp, 0, $headerSize);
    $respBody = substr($resp, $headerSize);
    curl_close($ch);

    http_response_code($status);
    header('Content-Type: application/json');
    echo $respBody;
    exit;
}

if ($provider === 'openai') {
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    if (!$apiKey && $json && isset($json['apiKey'])) { $apiKey = $json['apiKey']; }
    if (!$apiKey) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'missing apiKey']);
        exit;
    }
    $forwardBody = $body;
    if ($json !== null) { unset($json['apiKey']); $forwardBody = json_encode($json); }
    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $forwardBody);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180); // 🛡️ 2026-04 : 60 → 180 s pour longues générations IA
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl failed', 'detail' => $err]);
        exit;
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $respBody = substr($resp, $headerSize);
    curl_close($ch);
    http_response_code($status);
    header('Content-Type: application/json');
    echo $respBody;
    exit;
}

if ($provider === 'deepseek') {
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    if (!$apiKey && $json && isset($json['apiKey'])) { $apiKey = $json['apiKey']; }
    if (!$apiKey) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'missing apiKey']);
        exit;
    }
    $forwardBody = $body;
    if ($json !== null) { unset($json['apiKey']); $forwardBody = json_encode($json); }
    $ch = curl_init('https://api.deepseek.com/v1/chat/completions');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $forwardBody);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180); // 🛡️ 2026-04 : 60 → 180 s pour longues générations IA
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl failed', 'detail' => $err]);
        exit;
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $respBody = substr($resp, $headerSize);
    curl_close($ch);
    http_response_code($status);
    header('Content-Type: application/json');
    echo $respBody;
    exit;
}

if ($provider === 'groq') {
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    if (!$apiKey && $json && isset($json['apiKey'])) { $apiKey = $json['apiKey']; }
    if (!$apiKey) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'missing apiKey']);
        exit;
    }
    $forwardBody = $body;
    if ($json !== null) { unset($json['apiKey']); $forwardBody = json_encode($json); }
    $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $forwardBody);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($ch, CURLOPT_TIMEOUT, 180);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'curl failed', 'detail' => $err]);
        exit;
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $respBody = substr($resp, $headerSize);
    curl_close($ch);
    http_response_code($status);
    header('Content-Type: application/json');
    echo $respBody;
    exit;
}

http_response_code(400);
header('Content-Type: application/json');
echo json_encode(['error' => 'unsupported provider']);

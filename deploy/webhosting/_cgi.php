<?php
// gaia-space CGI front: one request -> one space-server process (webhosting, no daemons).
$root = dirname(__DIR__, 2) . '/space';
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = preg_replace('#^/space#', '', $uri);
$env = [
  'GATEWAY_INTERFACE' => 'CGI/1.1',
  'REQUEST_METHOD' => $_SERVER['REQUEST_METHOD'] ?? 'GET',
  'SPACE_PATH' => $path,
  'QUERY_STRING' => $_SERVER['QUERY_STRING'] ?? '',
  'CONTENT_TYPE' => $_SERVER['CONTENT_TYPE'] ?? '',
  'REMOTE_ADDR' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
  'SPACE_DB' => $root . '/data/space.db',
  'HOME' => $root,
  'PATH' => '/usr/local/bin:/usr/bin:/bin',
];
foreach (@parse_ini_file($root . '/space.env') ?: [] as $k => $v) $env[$k] = $v;
foreach ($_SERVER as $k => $v) if (strncmp($k, 'HTTP_', 5) === 0 && is_string($v)) $env[$k] = $v;
$p = proc_open([$root . '/space-server'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $root . '/data/stderr.log', 'a']], $pipes, $root, $env);
if (!is_resource($p)) { http_response_code(502); exit('space-server exec failed'); }
stream_copy_to_stream(fopen('php://input', 'r'), $pipes[0]);
fclose($pipes[0]);
$out = stream_get_contents($pipes[1]);
fclose($pipes[1]);
proc_close($p);
$sep = strpos($out, "\r\n\r\n");
if ($sep === false) { http_response_code(502); exit('bad cgi output'); }
foreach (explode("\r\n", substr($out, 0, $sep)) as $line) {
  if (strncasecmp($line, 'Status:', 7) === 0) { http_response_code((int) trim(substr($line, 7))); continue; }
  if (preg_match('/^(content-length|transfer-encoding|connection):/i', $line)) continue;
  header($line, false);
}
echo substr($out, $sep + 4);

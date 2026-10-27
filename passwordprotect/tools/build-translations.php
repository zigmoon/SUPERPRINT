<?php
/**
 * Builds languages/vaultgate.pot, languages/vaultgate-fr_FR.po and the
 * compiled .mo file from the source strings.
 *
 * Run with: php tools/build-translations.php
 *
 * @package VaultGate
 */

$root = dirname( __DIR__ );

$translations = require __DIR__ . '/fr-translations.php';

$files = new RecursiveIteratorIterator(
	new RecursiveDirectoryIterator( $root . '/vaultgate', FilesystemIterator::SKIP_DOTS )
);

$pattern = '#\b(__|esc_html__|esc_attr__|esc_html_e|esc_attr_e|_e|_x|_n)\s*\(\s*([\'"])((?:\\\\.|(?!\2).)*)\2#s';
$strings = array();
$refs    = array();

foreach ( $files as $file ) {
	if ( 'php' !== $file->getExtension() ) {
		continue;
	}

	$path   = $file->getPathname();
	$source = (string) file_get_contents( $path );
	$rel    = 'vaultgate/' . ltrim( str_replace( '\\', '/', substr( $path, strlen( $root . '/vaultgate/' ) ) ), '/' );

	if ( ! preg_match_all( $pattern, $source, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE ) ) {
		continue;
	}

	foreach ( $matches as $match ) {
		$text   = stripcslashes( $match[3][0] );
		$offset = $match[0][1];
		$line   = substr_count( substr( $source, 0, $offset ), "\n" ) + 1;

		$strings[ $text ] = true;
		$refs[ $text ][ $rel . ':' . $line ] = true;
	}
}

ksort( $strings, SORT_STRING );
ksort( $refs, SORT_STRING );

$missing = array();

foreach ( array_keys( $strings ) as $text ) {
	if ( ! array_key_exists( $text, $translations ) ) {
		$missing[] = $text;
	}
}

if ( array() !== $missing ) {
	echo "Missing French translations:\n";
	foreach ( $missing as $text ) {
		echo '  - ' . $text . "\n";
	}
	exit( 1 );
}

/**
 * Escapes a string for a PO file.
 *
 * @param string $value Raw value.
 */
function vg_po_escape( string $value ): string {
	return strtr(
		$value,
		array(
			'\\' => '\\\\',
			'"'  => '\\"',
			"\n" => '\\n',
			"\r" => '\\r',
			"\t" => '\\t',
		)
	);
}

$pot_header = "msgid \"\"\n"
	. "msgstr \"\"\n"
	. "\"Project-Id-Version: VaultGate 1.0.0\\n\"\n"
	. "\"Report-Msgid-Bugs-To: https://github.com/zigmoon/SUPERPRINT/issues\\n\"\n"
	. "\"POT-Creation-Date: 2026-10-27T00:00:00+00:00\\n\"\n"
	. "\"MIME-Version: 1.0\\n\"\n"
	. "\"Content-Type: text/plain; charset=UTF-8\\n\"\n"
	. "\"Content-Transfer-Encoding: 8bit\\n\"\n"
	. "\"X-Domain: vaultgate\\n\"\n";

$po_header = "msgid \"\"\n"
	. "msgstr \"\"\n"
	. "\"Project-Id-Version: VaultGate 1.0.0\\n\"\n"
	. "\"Report-Msgid-Bugs-To: https://github.com/zigmoon/SUPERPRINT/issues\\n\"\n"
	. "\"POT-Creation-Date: 2026-10-27T00:00:00+00:00\\n\"\n"
	. "\"PO-Revision-Date: 2026-10-27T00:00:00+00:00\\n\"\n"
	. "\"Last-Translator: zigmoon\\n\"\n"
	. "\"Language-Team: Français\\n\"\n"
	. "\"Language: fr_FR\\n\"\n"
	. "\"MIME-Version: 1.0\\n\"\n"
	. "\"Content-Type: text/plain; charset=UTF-8\\n\"\n"
	. "\"Content-Transfer-Encoding: 8bit\\n\"\n"
	. "\"Plural-Forms: nplurals=2; plural=(n > 1);\\n\"\n"
	. "\"X-Domain: vaultgate\\n\"\n";

$pot = "# Copyright (C) 2026 zigmoon\n# This file is distributed under the GPL-2.0-or-later license.\n" . $pot_header;
$po  = "# French translation for VaultGate.\n# This file is distributed under the GPL-2.0-or-later license.\n" . $po_header;

foreach ( array_keys( $strings ) as $text ) {
	$reference = '#: ' . implode( ' ', array_keys( $refs[ $text ] ) ) . "\n";

	$pot .= "\n" . $reference . 'msgid "' . vg_po_escape( $text ) . "\"\nmsgstr \"\"\n";
	$po  .= "\n" . $reference . 'msgid "' . vg_po_escape( $text ) . "\"\nmsgstr \"" . vg_po_escape( $translations[ $text ] ) . "\"\n";
}

file_put_contents( $root . '/vaultgate/languages/vaultgate.pot', $pot );
file_put_contents( $root . '/vaultgate/languages/vaultgate-fr_FR.po', $po );

/**
 * Compiles a PO catalogue to the binary MO format.
 *
 * @param array<string, string> $entries msgid => msgstr (header excluded).
 * @param string                $path    Destination.
 */
function vg_compile_mo( array $entries, string $path ): void {
	uksort( $entries, 'strcmp' );

	$count         = count( $entries );
	$originals     = array();
	$translations  = array();
	$data          = '';
	$original_rows = '';
	$trans_rows    = '';
	$string_offset = 28 + ( 16 * $count );

	foreach ( $entries as $msgid => $msgstr ) {
		$blob            = $msgid . "\0";
		$original_rows  .= pack( 'V', strlen( $blob ) - 1 ) . pack( 'V', $string_offset + strlen( $data ) );
		$data           .= $blob;
	}

	foreach ( $entries as $msgid => $msgstr ) {
		$blob            = $msgstr . "\0";
		$trans_rows     .= pack( 'V', strlen( $blob ) - 1 ) . pack( 'V', $string_offset + strlen( $data ) );
		$data           .= $blob;
	}

	$binary = pack( 'V', 0x950412de )
		. pack( 'V', 0 )
		. pack( 'V', $count )
		. pack( 'V', 28 )
		. pack( 'V', 28 + ( 8 * $count ) )
		. pack( 'V', 0 )
		. pack( 'V', 0 )
		. $original_rows
		. $trans_rows
		. $data;

	file_put_contents( $path, $binary );
}

$mo_header = "Project-Id-Version: VaultGate 1.0.0\n"
	. "Report-Msgid-Bugs-To: https://github.com/zigmoon/SUPERPRINT/issues\n"
	. "PO-Revision-Date: 2026-10-27T00:00:00+00:00\n"
	. "Last-Translator: zigmoon\n"
	. "Language-Team: Français\n"
	. "Language: fr_FR\n"
	. "MIME-Version: 1.0\n"
	. "Content-Type: text/plain; charset=UTF-8\n"
	. "Content-Transfer-Encoding: 8bit\n"
	. "Plural-Forms: nplurals=2; plural=(n > 1);\n"
	. "X-Domain: vaultgate\n";

$mo_entries = array_merge( array( '' => $mo_header ), $translations );

vg_compile_mo( $mo_entries, $root . '/vaultgate/languages/vaultgate-fr_FR.mo' );

/* Verify the compiled catalogue by reading it back. */
$raw    = (string) file_get_contents( $root . '/vaultgate/languages/vaultgate-fr_FR.mo' );
$header = unpack( 'Vmagic/Vrevision/Vcount/Voriginals/Vtranslations/Vhash_size/Vhash_offset', $raw );

uksort( $mo_entries, 'strcmp' );

if ( 0x950412de !== $header['magic'] || count( $mo_entries ) !== $header['count'] ) {
	echo "MO verification failed: bad header.\n";
	exit( 1 );
}

$read = array();

for ( $i = 0; $i < $header['count']; $i++ ) {
	$original    = unpack( 'Vlength/Voffset', substr( $raw, $header['originals'] + ( $i * 8 ), 8 ) );
	$translation = unpack( 'Vlength/Voffset', substr( $raw, $header['translations'] + ( $i * 8 ), 8 ) );
	$msgid       = substr( $raw, $original['offset'], $original['length'] );
	$msgstr      = substr( $raw, $translation['offset'], $translation['length'] );
	$read[ $msgid ] = $msgstr;
}

if ( $read !== $mo_entries ) {
	echo "MO verification failed: entries differ.\n";
	exit( 1 );
}

echo 'Wrote ' . count( $translations ) . " strings: vaultgate.pot, vaultgate-fr_FR.po, vaultgate-fr_FR.mo\n";

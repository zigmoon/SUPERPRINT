;; ─────────────────────────────────────────────────────────────────────────────
;; superprint-asm — luminance RVB → niveaux de gris (Rec. 709)
;;
;; Écrit À LA MAIN en WebAssembly Text (WAT) : c'est « l'assembleur du web »,
;; le seul langage d'assemblage qui s'exécute dans un navigateur.
;;
;; Équivalent bit-à-bit de `superprint_core::color::Rgb::luma` (Rust), qui est
;; lui-même l'équivalent de la luminance utilisée par SuperPrint pour le
;; passage en niveaux de gris (le chemin du défaut « PDF N&B de 131 Mo »).
;;
;;   y = arrondi(0.2126·r + 0.7152·g + 0.0722·b), borné 0..255
;;
;; Arrondi volontairement identique à `f64::round` de Rust (« au plus proche,
;; loin de zéro ») : pour des valeurs positives, c'est `floor(y + 0.5)`.
;; `f64.nearest` de WebAssembly (arrondi au pair) donnerait un résultat
;; DIFFÉRENT au demi-point exact — à ne pas utiliser ici.
;; ─────────────────────────────────────────────────────────────────────────────

(module
  ;; 512 pages = 32 Mio de mémoire linéaire (≈ 8 M de pixels RVB en plus de la
  ;; zone de sortie). La mémoire WebAssembly est allouée paresseusement.
  (memory (export "memory") 512)

  ;; y = clamp(floor(0.2126·r + 0.7152·g + 0.0722·b + 0.5), 0, 255)
  (func $luma (param $r i32) (param $g i32) (param $b i32) (result i32)
    local.get $r
    f64.convert_i32_u
    f64.const 0.2126
    f64.mul
    local.get $g
    f64.convert_i32_u
    f64.const 0.7152
    f64.mul
    f64.add
    local.get $b
    f64.convert_i32_u
    f64.const 0.0722
    f64.mul
    f64.add
    ;; arrondi « au plus proche, loin de zéro » (valeurs ≥ 0)
    f64.const 0.5
    f64.add
    f64.floor
    ;; bornage 0..255
    f64.const 0.0
    f64.max
    f64.const 255.0
    f64.min
    i32.trunc_f64_u
  )

  ;; luma_rgb_to_gray8(src, dst, n)
  ;;   lit `n` triplets RVB (3 octets chacun) à partir de `src`,
  ;;   écrit `n` octets de luminance à partir de `dst`.
  (func (export "luma_rgb_to_gray8") (param $src i32) (param $dst i32) (param $n i32)
    (local $i i32)
    (local $sp i32)
    (local $dp i32)
    (block $done
      (loop $loop
        local.get $i
        local.get $n
        i32.ge_u
        br_if $done

        ;; sp = src + i·3
        local.get $src
        local.get $i
        i32.const 3
        i32.mul
        i32.add
        local.set $sp

        ;; dp = dst + i
        local.get $dst
        local.get $i
        i32.add
        local.set $dp

        ;; mem[dp] = luma(mem[sp], mem[sp+1], mem[sp+2])
        local.get $dp
        local.get $sp
        i32.load8_u
        local.get $sp
        i32.load8_u offset=1
        local.get $sp
        i32.load8_u offset=2
        call $luma
        i32.store8

        ;; i += 1
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  ;; Version à octet unique : imprimeur RVB → un seul gris (cas unitaire,
  ;; pratique pour les tests et pour un usage ponctuel).
  (func (export "luma_rgb") (param $r i32) (param $g i32) (param $b i32) (result i32)
    local.get $r
    local.get $g
    local.get $b
    call $luma
  )
)

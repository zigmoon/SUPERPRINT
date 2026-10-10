;; ─────────────────────────────────────────────────────────────────────────────
;; superprint-asm — conversions CMJN ↔ RVB sur octets
;;
;; Écrit À LA MAIN en WebAssembly Text. Équivalent bit-à-bit du module Rust
;; `superprint_core::color8` (arithmétique entière, donc reproductible).
;;
;;   RVB → CMJN :  max = max(r,g,b) ; k = 255 - max
;;                 si max = 0 : c = m = y = 0, k = 255
;;                 sinon      : c = ((max-r)·255 + max/2) / max   (idem m, y)
;;
;;   CMJN → RVB :  kc = 255 - k
;;                 r = ((255-c)·kc + 127) / 255         (idem g, b)
;;
;; Les deux sens ARRONDISSENT : sans arrondi à l'aller, l'aller-retour
;; dériverait d'un cran sur près d'un pixel sur deux.
;;
;; Toutes les divisions sont ENTIÈRES (tronquées) : même résultat en Rust
;; (`u32` division) et en WebAssembly (`i32.div_u`).
;;
;; Disposition mémoire — RVB : 3 octets par pixel (r, g, b) ;
;;                        CMJN : 4 octets par pixel (c, m, y, k).
;; ─────────────────────────────────────────────────────────────────────────────

(module
  ;; 512 pages = 32 Mio (alloués paresseusement).
  (memory (export "memory") 512)

  ;; rgb_to_cmyk(src, dst, n)
  ;;   lit n triplets RVB à partir de src, écrit n quadruplets CMJN à partir de dst.
  (func (export "rgb_to_cmyk") (param $src i32) (param $dst i32) (param $n i32)
    (local $i i32) (local $sp i32) (local $dp i32)
    (local $r i32) (local $g i32) (local $b i32)
    (local $max i32) (local $c i32) (local $m i32) (local $y i32) (local $k i32)

    (block $done
      (loop $loop
        local.get $i
        local.get $n
        i32.ge_u
        br_if $done

        ;; sp = src + i·3 ; dp = dst + i·4
        local.get $src
        local.get $i
        i32.const 3
        i32.mul
        i32.add
        local.set $sp
        local.get $dst
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        local.set $dp

        ;; r, g, b
        local.get $sp
        i32.load8_u
        local.set $r
        local.get $sp
        i32.load8_u offset=1
        local.set $g
        local.get $sp
        i32.load8_u offset=2
        local.set $b

        ;; max = max(r, g, b)
        local.get $r
        local.set $max
        local.get $g
        local.get $max
        i32.gt_u
        if
          local.get $g
          local.set $max
        end
        local.get $b
        local.get $max
        i32.gt_u
        if
          local.get $b
          local.set $max
        end

        ;; valeurs par défaut : le noir (max = 0)
        i32.const 0
        local.set $c
        i32.const 0
        local.set $m
        i32.const 0
        local.set $y
        i32.const 255
        local.set $k

        ;; si max ≠ 0, calcul réel
        local.get $max
        if
          ;; k = 255 - max
          i32.const 255
          local.get $max
          i32.sub
          local.set $k
          ;; c = ((max - r)·255 + max/2) / max
          local.get $max
          local.get $r
          i32.sub
          i32.const 255
          i32.mul
          local.get $max
          i32.const 1
          i32.shr_u
          i32.add
          local.get $max
          i32.div_u
          local.set $c
          ;; m = ((max - g)·255 + max/2) / max
          local.get $max
          local.get $g
          i32.sub
          i32.const 255
          i32.mul
          local.get $max
          i32.const 1
          i32.shr_u
          i32.add
          local.get $max
          i32.div_u
          local.set $m
          ;; y = ((max - b)·255 + max/2) / max
          local.get $max
          local.get $b
          i32.sub
          i32.const 255
          i32.mul
          local.get $max
          i32.const 1
          i32.shr_u
          i32.add
          local.get $max
          i32.div_u
          local.set $y
        end

        ;; écriture : dst[0..4] = c, m, y, k
        local.get $dp
        local.get $c
        i32.store8
        local.get $dp
        local.get $m
        i32.store8 offset=1
        local.get $dp
        local.get $y
        i32.store8 offset=2
        local.get $dp
        local.get $k
        i32.store8 offset=3

        ;; i += 1
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  ;; cmyk_to_rgb(src, dst, n)
  ;;   lit n quadruplets CMJN à partir de src, écrit n triplets RVB à partir de dst.
  (func (export "cmyk_to_rgb") (param $src i32) (param $dst i32) (param $n i32)
    (local $i i32) (local $sp i32) (local $dp i32)
    (local $c i32) (local $m i32) (local $y i32) (local $k i32)
    (local $kc i32)

    (block $done
      (loop $loop
        local.get $i
        local.get $n
        i32.ge_u
        br_if $done

        local.get $src
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        local.set $sp
        local.get $dst
        local.get $i
        i32.const 3
        i32.mul
        i32.add
        local.set $dp

        ;; c, m, y, k
        local.get $sp
        i32.load8_u
        local.set $c
        local.get $sp
        i32.load8_u offset=1
        local.set $m
        local.get $sp
        i32.load8_u offset=2
        local.set $y
        local.get $sp
        i32.load8_u offset=3
        local.set $k

        ;; kc = 255 - k
        i32.const 255
        local.get $k
        i32.sub
        local.set $kc

        ;; r = ((255-c)·kc + 127) / 255  → dst[0]
        local.get $dp
        i32.const 255
        local.get $c
        i32.sub
        local.get $kc
        i32.mul
        i32.const 127
        i32.add
        i32.const 255
        i32.div_u
        i32.store8
        ;; g → dst[1]
        local.get $dp
        i32.const 255
        local.get $m
        i32.sub
        local.get $kc
        i32.mul
        i32.const 127
        i32.add
        i32.const 255
        i32.div_u
        i32.store8 offset=1
        ;; b → dst[2]
        local.get $dp
        i32.const 255
        local.get $y
        i32.sub
        local.get $kc
        i32.mul
        i32.const 127
        i32.add
        i32.const 255
        i32.div_u
        i32.store8 offset=2

        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  ;; Conversions d'un seul pixel — pratiques pour les tests et l'usage ponctuel.
  (func (export "rgb_to_cmyk_px") (param $r i32) (param $g i32) (param $b i32) (result i64)
    ;; Renvoie c | m<<8 | y<<16 | k<<24 (empaquetage little-endian).
    (local $max i32)
    (local $c i32) (local $m i32) (local $y i32) (local $k i32)
    local.get $r
    local.set $max
    local.get $g
    local.get $max
    i32.gt_u
    if (local.set $max (local.get $g)) end
    local.get $b
    local.get $max
    i32.gt_u
    if (local.set $max (local.get $b)) end
    local.get $max
    i32.eqz
    if
      i32.const 0
      local.set $c
      i32.const 0
      local.set $m
      i32.const 0
      local.set $y
      i32.const 255
      local.set $k
    else
      i32.const 255
      local.get $max
      i32.sub
      local.set $k
      local.get $max local.get $r i32.sub i32.const 255 i32.mul local.get $max i32.const 1 i32.shr_u i32.add local.get $max i32.div_u
      local.set $c
      local.get $max local.get $g i32.sub i32.const 255 i32.mul local.get $max i32.const 1 i32.shr_u i32.add local.get $max i32.div_u
      local.set $m
      local.get $max local.get $b i32.sub i32.const 255 i32.mul local.get $max i32.const 1 i32.shr_u i32.add local.get $max i32.div_u
      local.set $y
    end
    local.get $c
    i64.extend_i32_u
    local.get $m
    i64.extend_i32_u
    i64.const 8
    i64.shl
    i64.or
    local.get $y
    i64.extend_i32_u
    i64.const 16
    i64.shl
    i64.or
    local.get $k
    i64.extend_i32_u
    i64.const 24
    i64.shl
    i64.or
  )

  (func (export "cmyk_to_rgb_px") (param $c i32) (param $m i32) (param $y i32) (param $k i32) (result i64)
    ;; Renvoie r | g<<8 | b<<16.
    (local $kc i32) (local $r i32) (local $g i32) (local $b i32)
    i32.const 255
    local.get $k
    i32.sub
    local.set $kc
    i32.const 255 local.get $c i32.sub local.get $kc i32.mul i32.const 127 i32.add i32.const 255 i32.div_u
    local.set $r
    i32.const 255 local.get $m i32.sub local.get $kc i32.mul i32.const 127 i32.add i32.const 255 i32.div_u
    local.set $g
    i32.const 255 local.get $y i32.sub local.get $kc i32.mul i32.const 127 i32.add i32.const 255 i32.div_u
    local.set $b
    local.get $r
    i64.extend_i32_u
    local.get $g
    i64.extend_i32_u
    i64.const 8
    i64.shl
    i64.or
    local.get $b
    i64.extend_i32_u
    i64.const 16
    i64.shl
    i64.or
  )
)

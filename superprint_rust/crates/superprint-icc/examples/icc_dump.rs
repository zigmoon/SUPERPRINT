//! Dump d'un **profil ICC**, pour comparaison avec une relecture indépendante.
//!
//! Usage :
//!
//! ```text
//! icc_dump <profil.icc> <sortie>
//! ```
//!
//! Sortie en TSV, une ligne par information :
//!
//! ```text
//! taille     <octets déclarés>
//! version    <majeure> <mineure>
//! classe     <classe>
//! espace     <espace>
//! composantes <n>
//! pcs        <Lab|XYZ|…>
//! blanc      <x> <y> <z>
//! intention  <n>
//! nom        <nom du profil>
//! sortie     0|1        (peut servir d'OutputIntent)
//! balise     <sig> <décalage> <taille> <type> <entrées> <sorties> <grille> <calculée> <écart>
//! erreur     <message>  (si le fichier est refusé)
//! ```

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_icc::Profil;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("usage : icc_dump <profil.icc> <sortie>");
        return ExitCode::from(2);
    }
    let Ok(octets) = fs::read(&args[1]) else {
        eprintln!("fichier illisible : {}", args[1]);
        return ExitCode::from(2);
    };

    let texte = match Profil::lire(&octets) {
        Ok(p) => {
            let mut lignes = vec![
                format!("taille\t{}", p.taille_declaree),
                format!("version\t{} {}", p.version_majeure, p.version_mineure),
                format!("classe\t{}", p.classe),
                format!("espace\t{}", p.espace),
                format!("composantes\t{}", p.espace.composantes()),
                format!("pcs\t{}", p.pcs),
                format!(
                    "blanc\t{:.6}\t{:.6}\t{:.6}",
                    p.point_blanc.x, p.point_blanc.y, p.point_blanc.z
                ),
                format!("intention\t{}", p.intention),
                format!("nom\t{}", p.nom),
                format!("sortie\t{}", u8::from(p.peut_servir_de_sortie())),
            ];
            for b in &p.balises {
                let (e, s, g, calculee) = match b.table {
                    Some(t) => (
                        t.entrees.to_string(),
                        t.sorties.to_string(),
                        t.points_de_grille.to_string(),
                        b.taille_calculee()
                            .map_or("—".to_string(), |v| v.to_string()),
                    ),
                    None => (
                        "—".to_string(),
                        "—".to_string(),
                        "—".to_string(),
                        "—".to_string(),
                    ),
                };
                lignes.push(format!(
                    "balise\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    b.signature,
                    b.decalage,
                    b.taille,
                    String::from_utf8_lossy(&b.type_balise).trim(),
                    e,
                    s,
                    g,
                    calculee,
                    b.ecart_de_taille()
                        .map_or("—".to_string(), |v| v.to_string()),
                ));
            }
            /* L'écart de la spécification, résumé en une ligne : c'est la
            mesure, pas une interprétation. */
            lignes.push(format!("hors-norme\t{}", p.balises_hors_norme().len()));
            lignes.join("\n")
        }
        Err(e) => format!("erreur\t{e}"),
    };

    if let Err(e) = fs::write(&args[2], texte) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

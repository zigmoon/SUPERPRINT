//! Dump des **nuanciers**, pour comparaison avec le JavaScript du produit.
//!
//! Cet exemple n'est pas une démonstration : c'est la moitié Rust d'une preuve.
//! `scripts/validate-swatch.mjs` évalue le tableau `BOOKS` de
//! `app/JS/swatchbooks.js` et les `<optgroup>` de `app/index.html` **sans les
//! modifier**, puis exécute le `lireAse` du produit sur des fichiers `.ase`
//! engendrés — et compare ligne à ligne.
//!
//! Usage (le **dernier** argument est toujours le fichier de sortie) :
//!
//! ```text
//! swatch_dump catalogue                    <sortie>
//! swatch_dump chercher <requete> <limite>  <sortie>
//! swatch_dump proche   <#RRGGBB> <livre|-> <sortie>
//! swatch_dump ase      <fichier.ase>       <sortie>
//! ```
//!
//! Sortie `catalogue` (TSV) :
//!
//! ```text
//! livre        <id>  <nom>
//! echantillon  <n>
//! teinte       <famille>  <nom>  <#RRGGBB>
//! total        <nombre-de-teintes>
//! ```
//!
//! Sortie `chercher` / `proche` :
//!
//! ```text
//! teinte <livre> <famille> <nom> <#RRGGBB> [<dE00> <dE76>]
//! ```
//!
//! ⚠️ Le lecteur `.ase` de cet exemple est celui du crate, `ase::lire` :
//! **la même fonction** que celle qu'emploie la frontière C.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_swatch::ase;
use superprint_swatch::catalogue::{catalogue, hex_depuis_rgb, rgb_depuis_hex};
use superprint_swatch::recherche::{chercher, plus_proche, plus_proche_dans};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    if args.len() < 3 {
        return usage();
    }
    let sortie = &args[args.len() - 1];
    let entrees: Vec<&String> = args[2..args.len() - 1].iter().collect();

    let texte = match mode.as_str() {
        "catalogue" => dump_catalogue(),
        "chercher" => {
            let (Some(requete), Some(limite)) = (entrees.first(), entrees.get(1)) else {
                return usage();
            };
            let limite = limite.trim().parse::<usize>().unwrap_or(0);
            chercher(catalogue(), requete, limite)
                .iter()
                .map(|t| {
                    format!(
                        "teinte\t{}\t{}\t{}\t{}",
                        t.livre_id,
                        t.famille,
                        t.pastille.nom,
                        t.pastille.hex()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        "proche" => {
            let Some(cible) = entrees.first().and_then(|h| rgb_depuis_hex(h)) else {
                eprintln!("couleur invalide : {:?}", entrees.first());
                return ExitCode::from(2);
            };
            let livre = entrees.get(1).map(|s| s.as_str()).filter(|s| *s != "-");
            let resultat = match livre {
                Some(id) => plus_proche_dans(catalogue(), id, cible),
                None => plus_proche(catalogue(), cible),
            };
            match resultat {
                Some(p) => format!(
                    "teinte\t{}\t{}\t{}\t{}\t{:.6}\t{:.6}",
                    p.trouvaille.livre_id,
                    p.trouvaille.famille,
                    p.trouvaille.pastille.nom,
                    p.trouvaille.pastille.hex(),
                    p.delta_e2000,
                    p.delta_e76
                ),
                None => String::new(),
            }
        }
        "ase" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let Ok(octets) = fs::read(chemin) else {
                eprintln!("fichier illisible : {chemin}");
                return ExitCode::from(2);
            };
            match ase::lire(&octets) {
                Ok(releve) => {
                    let mut lignes: Vec<String> = releve
                        .familles
                        .iter()
                        .map(|f| format!("groupe\t{}", f.label))
                        .collect();
                    lignes.extend(
                        releve
                            .teintes
                            .iter()
                            .map(|p| format!("teinte\t{}\t{}", p.nom, p.hex())),
                    );
                    lignes.join("\n")
                }
                /* L'erreur part sur la sortie normale : le script de contrôle
                doit voir exactement ce que voit l'application. */
                Err(e) => format!("erreur\t{e}"),
            }
        }
        autre => {
            eprintln!("mode inconnu : {autre}");
            return ExitCode::from(2);
        }
    };

    if let Err(e) = fs::write(sortie, texte) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage : swatch_dump <catalogue|chercher|proche|ase> <entree...> <sortie>");
    ExitCode::from(2)
}

fn dump_catalogue() -> String {
    let c = catalogue();
    let mut lignes: Vec<String> = Vec::new();
    for livre in &c.livres {
        lignes.push(format!("livre\t{}\t{}", livre.id, livre.nom));
        if livre.echantillon > 0 {
            lignes.push(format!("echantillon\t{}", livre.echantillon));
        }
        for famille in &livre.familles {
            for pastille in &famille.teintes {
                lignes.push(format!(
                    "teinte\t{}\t{}\t{}",
                    famille.label,
                    pastille.nom,
                    hex_depuis_rgb(pastille.rgb)
                ));
            }
        }
    }
    lignes.push(format!("total\t{}", c.nombre_teintes()));
    lignes.join("\n")
}

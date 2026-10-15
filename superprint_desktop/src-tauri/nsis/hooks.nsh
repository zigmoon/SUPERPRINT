/* ════════════════════════════════════════════════════════════════════════════
   hooks.nsh — LES GREFFES NSIS DE SUPERPRINT.

   POURQUOI CE FICHIER EXISTE

   L'installeur Tauri sait REMPLACER une version déjà installée : il lance
   l'ancien désinstalleur, attend son code de retour, puis installe. Mais si ce
   désinstalleur échoue — et il échoue dès que l'application TOURNE, parce que
   Windows verrouille un `.exe` en cours d'exécution — le gabarit affiche un
   message générique (« unableToUninstall ») et appelle `Abort` : l'utilisateur
   se retrouve sans issue, sans même savoir qu'il suffisait de fermer le
   logiciel.

   LA CORRECTION, ET POURQUOI ELLE EST ICI ET PAS DANS LE GABARIT

   Le gabarit NSIS de Tauri appelle quatre greffes officielles :

       !ifmacrodef NSIS_HOOK_PREINSTALL    /  POSTINSTALL
       !ifmacrodef NSIS_HOOK_PREUNINSTALL  /  POSTUNINSTALL

   Elles existent exactement pour ça. On ajoute donc du code AVANT l'opération,
   sans jamais remplacer le gabarit : un gabarit recopié devrait suivre chaque
   mise à jour de tauri-cli, et une divergence se paierait par un installeur
   cassé — alors qu'une greffe manquante est simplement… absente.

   CE QUE LA GREFFE FAIT

   Elle ferme l'application AVANT que le désinstalleur n'ait à toucher à ses
   fichiers. On ne devine pas si elle tourne : `taskkill` le dit par son code de
   retour. On demande d'abord une FERMETURE PROPRE (sans `/F`, donc
   l'application peut enregistrer son travail), puis on force si elle résiste.
   Si elle résiste malgré tout, on s'arrête avec une consigne CLAIRE.

   Les messages suivent la langue choisie dans l'installeur ($LANGUAGE), comme
   le reste de l'assistant. ⚠️ Pas de `LangString` ici : la greffe est compilée
   avant que les langues ne soient chargées. On choisit donc le texte à
   l'exécution, avec les constantes de MUI2.

   ⚠️ REGISTRES : on n'emploie que $R5 à $R8. Les registres $0/$1 et $R0/$R1
   sont déjà utilisés par le gabarit autour des points d'insertion (WebView2,
   section de désinstallation) ; prendre les hauts évite d'écraser une valeur
   qui sert encore.
   ════════════════════════════════════════════════════════════════════════════ */

!include LogicLib.nsh

/**
 * Ferme l'application si elle tourne.
 *
 * Résultat dans `$R5` : 0 = on peut continuer, 1 = impossible de la fermer
 * (l'appelant doit s'arrêter).
 */
!macro SP_FERMER_APPLICATION

  ; ── Le binaire est-il là ? Sur une PREMIÈRE installation il n'y a rien à
  ;    fermer : on sort tout de suite, sans déranger l'utilisateur.
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 sp_app_absente

  ; ── `taskkill` SANS `/F` demande une fermeture PROPRE : l'application reçoit
  ;    la demande, ferme ses fenêtres, et peut enregistrer. Le code de retour
  ;    vaut 0 si un processus a été trouvé, 128 s'il n'y en avait aucun : c'est
  ;    donc aussi notre test de présence, et il ne coûte rien de plus.
  ClearErrors
  ExecWait 'taskkill /IM "${MAINBINARYNAME}.exe"' $R6
  ${If} $R6 = 0
    ; Une fermeture propre est asynchrone : laissons le temps de sortir avant
    ; de juger, sinon on conclurait trop vite qu'elle résiste.
    Sleep 1500
  ${EndIf}

  ; ── Toujours là ? Elle a refusé de se fermer (dialogue « Enregistrer les
  ;    modifications ? », fenêtre bloquée). On force, et on attend.
  ClearErrors
  ExecWait 'taskkill /IM "${MAINBINARYNAME}.exe" /F' $R7
  ${If} $R7 = 0
    Sleep 800
  ${EndIf}

  ; ── Dernier contrôle, par une MESURE et non par une supposition : un `.exe`
  ;    en cours d'exécution ne peut pas être supprimé. On essaie donc de le
  ;    supprimer ; si Windows refuse, un processus le tient encore.
  ClearErrors
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  ${If} ${Errors}
    ${If} $LANGUAGE = ${LANG_FRENCH}
      StrCpy $R8 "${PRODUCTNAME} est en cours d'execution.$\r$\n$\r$\nL'installation doit le fermer pour pouvoir remplacer ses fichiers.$\r$\nFermez ${PRODUCTNAME}, puis relancez l'installation."
    ${ElseIf} $LANGUAGE = ${LANG_JAPANESE}
      StrCpy $R8 "${PRODUCTNAME} が実行中です。$\r$\n$\r$\nファイルを置き換えるには終了が必要です。$\r$\n${PRODUCTNAME} を終了してから、もう一度インストールを実行してください。"
    ${Else}
      StrCpy $R8 "${PRODUCTNAME} is still running.$\r$\n$\r$\nSetup must close it before it can replace its files.$\r$\nClose ${PRODUCTNAME}, then run setup again."
    ${EndIf}
    MessageBox MB_OK|MB_ICONSTOP "$R8"
    StrCpy $R5 1
    Goto sp_app_fin
  ${EndIf}

  StrCpy $R5 0
  Goto sp_app_fin

  sp_app_absente:
    StrCpy $R5 0

  sp_app_fin:

!macroend

/* ── AVANT L'INSTALLATION (neuve, ou par-dessus une version existante) ─────── */
!macro NSIS_HOOK_PREINSTALL
  !insertmacro SP_FERMER_APPLICATION
  ${If} $R5 = 1
    Abort
  ${EndIf}
!macroend

/* ── AVANT LA DÉSINSTALLATION ───────────────────────────────────────────────
   Le même garde-fou, et c'est ce qui répond au besoin exprimé : pouvoir
   DÉSINSTALLER sans que Windows refuse parce que l'application occupe ses
   fichiers. Une désinstallation qui échoue en silence est pire qu'une
   désinstallation qui demande de fermer le logiciel. */
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro SP_FERMER_APPLICATION
  ${If} $R5 = 1
    Abort
  ${EndIf}
!macroend

/**
 * `<head>` shared by every transactional email shell. The templates are
 * already dark (navy/gold); without a declaration, mail clients with a
 * dark mode (Outlook, Apple Mail, the Gmail apps) treat them as light
 * and re-colour them, washing out the gold and inverting the navy.
 * `color-scheme` / `supported-color-schemes` = "dark only" opts out;
 * the shells also carry `bgcolor` attributes because some clients strip
 * inline `background` styles.
 */
export const EMAIL_DARK_HEAD = `<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark only">
    <meta name="supported-color-schemes" content="dark only">
  </head>`;

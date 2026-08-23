/* Genera il foglio di stile di Tailwind e lo incorpora in index.html.
 *
 *   node build/costruisci_css.js             riscrive il blocco in pagina
 *   node build/costruisci_css.js --verifica  non scrive, dice solo se e' vecchio
 *
 * Perche' non la CDN. cdn.tailwindcss.com compila il CSS nel browser di chi
 * visita: costa una richiesta a un terzo (che vede l'indirizzo IP del
 * visitatore), un avviso in console che dichiara la CDN inadatta alla
 * produzione, e un istante di pagina senza stile. Qui il foglio si costruisce
 * una volta, in fase di preparazione, e viaggia dentro l'unico file.
 *
 * Il prezzo e' che il CSS ora e' contenuto generato: se qualcuno aggiunge una
 * classe al markup e non rigenera, quella classe non ha regole. Per questo
 * esiste --verifica, che il workflow esegue a ogni push.
 *
 * Esce con codice 0 se il blocco e' allineato, 10 se e' stato riscritto
 * (o, con --verifica, se andrebbe riscritto).
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RADICE = path.join(__dirname, '..');
const INDEX = path.join(RADICE, 'index.html');
const INIZIO = '/* === INIZIO CSS TAILWIND: rigenerato da build/costruisci_css.js === */';
const FINE = '/* === FINE CSS TAILWIND === */';
const VERSIONE_TAILWIND = 'tailwindcss@3.4.19';

/* La stessa configurazione che la pagina dichiarava alla CDN. Tailwind non
 * legge index.html cosi' com'e' ma una copia senza il blocco generato: i nomi
 * di classe compaiono anche nei selettori del CSS, e scandire il proprio
 * risultato farebbe crescere il foglio a ogni esecuzione. */
const configPer = (sorgente) => `module.exports = {
  content: [${JSON.stringify(sorgente)}],
  theme: { extend: { colors: { brand: {
    50: '#eef4ff', 100: '#dae6ff', 200: '#bcd2ff', 300: '#8fb4ff',
    400: '#5b8cfd', 500: '#3665f5', 600: '#2148e3', 700: '#1b39c0',
    800: '#1c339c', 900: '#1d307b'
  } } } },
  plugins: []
};
`;

function generaCss(markup) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
  const config = path.join(tmp, 'tailwind.config.js');
  const ingresso = path.join(tmp, 'in.css');
  const uscita = path.join(tmp, 'out.css');
  const sorgente = path.join(tmp, 'markup.html');
  fs.writeFileSync(sorgente, markup);
  fs.writeFileSync(config, configPer(sorgente));
  fs.writeFileSync(ingresso, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  execFileSync('npx', ['--yes', VERSIONE_TAILWIND, '-c', config, '-i', ingresso, '-o', uscita, '--minify'],
               {stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32'});
  const css = fs.readFileSync(uscita, 'utf8').trim();
  fs.rmSync(tmp, {recursive: true, force: true});
  return css;
}

function main() {
  const soloVerifica = process.argv.includes('--verifica');
  const pagina = fs.readFileSync(INDEX, 'utf8');
  const a = pagina.indexOf(INIZIO);
  const b = pagina.indexOf(FINE);
  if (a === -1 || b === -1) {
    console.error('Marcatori del blocco CSS non trovati in index.html.');
    return 1;
  }

  const attuale = pagina.slice(a + INIZIO.length, b).trim();
  const senzaBlocco = pagina.slice(0, a + INIZIO.length) + pagina.slice(b);
  const nuovo = generaCss(senzaBlocco);

  if (attuale === nuovo) {
    console.log('CSS gia allineato al markup: nessuna classe nuova o rimossa.');
    return 0;
  }
  if (soloVerifica) {
    console.error('Il CSS in pagina non corrisponde al markup: esegui node build/costruisci_css.js');
    return 10;
  }

  const eol = pagina.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(INDEX, pagina.slice(0, a + INIZIO.length) + eol + nuovo + eol + pagina.slice(b));
  console.log(`CSS rigenerato: ${Math.round(nuovo.length / 1024)} KB incorporati in index.html.`);
  return 10;
}

process.exit(main());

#!/usr/bin/env node
// Ponte MCP: sobe o @playwright/mcp apontado para o painel de browser do Micah.
//
// O Micah (src-tauri/src/modules/browser) abre a webview-filha com
// --remote-debugging-port aleatório e escreve o arquivo de descoberta
// %APPDATA%/app.orvoton.micah/browser-cdp.json ({ port, ws_endpoint, pid, ... }).
// A porta muda a cada abertura do painel, então nenhuma config estática serve:
// este wrapper lê o arquivo na hora do boot do MCP e repassa o endpoint vivo.
//
// Registro (escopo user):
//   claude mcp add --scope user micah-browser -- node C:\Users\Zigfriad\projetos\micah\scripts\micah-playwright-mcp.mjs
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const file = join(process.env.APPDATA, 'app.orvoton.micah', 'browser-cdp.json');
let info;
try {
  info = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`micah-browser: nao li ${file} — o painel de browser do Micah esta aberto? (${e.message})`);
  process.exit(1);
}

const endpoint = `http://127.0.0.1:${info.port}`;
try {
  await fetch(`${endpoint}/json/version`);
} catch {
  console.error(`micah-browser: porta ${info.port} muda — arquivo de descoberta velho (crash?); feche e reabra o painel do Micah.`);
  process.exit(1);
}

const child = spawn('npx', ['-y', '@playwright/mcp@latest', '--cdp-endpoint', endpoint], {
  stdio: 'inherit',
  shell: true, // no Windows o npx e .cmd; sem shell o spawn falha com EINVAL
});
child.on('exit', (code) => process.exit(code ?? 1));

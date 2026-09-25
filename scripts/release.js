#!/usr/bin/env node
/**
 * Publica uma nova versão do P4J3 Prospect em um comando.
 *
 *   npm run release                         → 1.4.0 → 1.4.1 (correção)
 *   npm run release -- minor                → 1.4.0 → 1.5.0 (novidade)
 *   npm run release -- patch "mensagem"     → inclui alterações pendentes num commit
 *   npm run release -- patch --no-wait      → não espera o build do GitHub
 *
 * Passos: confere a branch, sincroniza com o GitHub, roda os testes, sobe a
 * versão, cria commit + tag e envia. O GitHub Actions gera o instalador e
 * publica a release; os apps instalados se atualizam sozinhos.
 */
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkgPath = path.join(root, "package.json");

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const gitLoud = (...args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });
// npm é .cmd no Windows: precisa de shell. Nenhum argumento vem do usuário aqui.
const npm = (command) => execSync(`npm ${command}`, { cwd: root, stdio: "inherit" });

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▶ ${message}`);
}

function bump(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function waitForRelease(owner, repo, tag) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { accept: "application/vnd.github+json", "user-agent": "p4j3-release" };
  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < 40 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 30000));
    try {
      const res = await fetch(`${api}/actions/runs?event=push&per_page=10`, { headers });
      const run = (await res.json()).workflow_runs?.find((r) => r.name === "Release" && r.head_branch === tag);
      const status = run ? `${run.status}${run.conclusion ? `/${run.conclusion}` : ""}` : "aguardando início";
      const minutes = Math.round((Date.now() - started) / 60000);
      if (status !== lastStatus || minutes % 3 === 0) console.log(`  … build ${status} (${minutes} min)`);
      lastStatus = status;
      if (run?.status === "completed") {
        if (run.conclusion !== "success") fail(`O build falhou. Veja o log: ${run.html_url}`);
        return true;
      }
    } catch {
      // Sem internet por um instante: tenta de novo no próximo ciclo.
    }
  }
  console.log("  Ainda gerando após 40 min; acompanhe pelo link do Actions.");
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const noWait = args.includes("--no-wait");
  const rest = args.filter((a) => a !== "--no-wait");
  const type = ["patch", "minor", "major"].includes(rest[0]) ? rest.shift() : "patch";
  const message = rest.join(" ").trim();

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const publish = (pkg.build?.publish || [])[0] || {};
  if (!publish.owner || !publish.repo) fail("build.publish (owner/repo) não configurado no package.json.");

  step("Conferindo o repositório");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") fail(`Você está na branch "${branch}". Publique a partir da main.`);
  const pending = git("status", "--porcelain");
  if (pending && !message) {
    console.log(pending);
    fail('Há alterações não salvas no git. Rode de novo com uma mensagem, ex.: npm run release -- patch "ajusta campanhas"');
  }
  if (pending) {
    gitLoud("add", "-A");
    gitLoud("commit", "-m", message);
  }

  step("Sincronizando com o GitHub");
  gitLoud("pull", "--ff-only", "origin", "main");

  step("Rodando os testes");
  npm("test");

  const next = bump(pkg.version, type);
  const tag = `v${next}`;
  step(`Subindo versão ${pkg.version} → ${next}`);
  npm(`version ${next} --no-git-tag-version`);
  gitLoud("add", "package.json", "package-lock.json");
  gitLoud("commit", "-m", `release: ${tag}`);
  gitLoud("tag", "-a", tag, "-m", `P4J3 Prospect ${tag}`);

  step("Enviando para o GitHub (dispara o build do instalador)");
  gitLoud("push", "origin", "main", tag);

  const actions = `https://github.com/${publish.owner}/${publish.repo}/actions`;
  const download = `https://github.com/${publish.owner}/${publish.repo}/releases/latest`;
  console.log(`\n✔ ${tag} enviada. Build: ${actions}`);
  if (noWait) {
    console.log(`  Quando terminar (~15 min), o download fica em: ${download}\n`);
    return;
  }
  step("Acompanhando o build (pode fechar com Ctrl+C: a publicação continua no GitHub)");
  if (await waitForRelease(publish.owner, publish.repo, tag)) {
    console.log(`\n✔ ${tag} publicada! Download: ${download}`);
    console.log("  Os apps instalados vão se atualizar sozinhos ao abrir.\n");
  }
}

main().catch((error) => fail(error.message));

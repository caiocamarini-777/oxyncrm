import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Servidor Next temporário (next dev) numa cópia do projeto, com ambiente próprio. Serve para specs que precisam
 * de variáveis diferentes das do servidor de dev em :3000 (que não é tocado). A cópia fica em E2E_TMP_DIR (ou no
 * diretório temporário do sistema) e é reaproveitada entre execuções para manter o cache de compilação.
 * O .env.local copiado não leva as variáveis PIPEDRIVE_*.
 */
export type TempNext = { url: string; pid: number; stop(): Promise<void> };

// ancorados na raiz (sem a barra, "supabase" também tiraria src/lib/supabase)
const EXCLUDES = [
  "/.git",
  "/node_modules",
  "/.next",
  "/.env*",
  "/test-results",
  "/playwright-report",
  "/.superpowers",
  "/.claude",
  "/.e2e-outbox",
  "/supabase",
  "/docs",
  "/.node_modules.lock",
];

function prepareCopy(root: string, dir: string) {
  mkdirSync(dir, { recursive: true });
  const rsync = spawnSync("rsync", ["-a", "--delete", ...EXCLUDES.flatMap((e) => ["--exclude", e]), `${root}/`, `${dir}/`], {
    stdio: "inherit",
  });
  if (rsync.status !== 0) throw new Error("rsync falhou ao copiar o projeto");
  // node_modules: clone (APFS) só quando falta ou o lockfile mudou
  const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const stampFile = path.join(dir, ".node_modules.lock");
  if (!existsSync(path.join(dir, "node_modules")) || !existsSync(stampFile) || readFileSync(stampFile, "utf8") !== lock) {
    spawnSync("rm", ["-rf", path.join(dir, "node_modules")]);
    const cp = spawnSync("cp", ["-cR", path.join(root, "node_modules"), path.join(dir, "node_modules")], { stdio: "inherit" });
    if (cp.status !== 0) {
      const plain = spawnSync("cp", ["-R", path.join(root, "node_modules"), path.join(dir, "node_modules")], { stdio: "inherit" });
      if (plain.status !== 0) throw new Error("não foi possível copiar node_modules");
    }
    writeFileSync(stampFile, lock);
  }
  const envFile = path.join(root, ".env.local");
  const env = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
        .split("\n")
        .filter((l) => !/^\s*PIPEDRIVE_/.test(l))
        .join("\n")
    : "";
  writeFileSync(path.join(dir, ".env.local"), env);
}

async function waitUp(url: string, child: ChildProcess, timeoutMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`next dev terminou com código ${child.exitCode}`);
    try {
      const res = await fetch(`${url}/entrar`, { signal: AbortSignal.timeout(60_000) });
      if (res.status < 500) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev não respondeu em ${timeoutMs / 1000}s`);
}

export async function startTempNext(opts: { name: string; port: number; env: Record<string, string> }): Promise<TempNext> {
  const root = process.cwd();
  const dir = path.join(process.env.E2E_TMP_DIR || os.tmpdir(), `oxyn-e2e-${opts.name}`);
  prepareCopy(root, dir);
  const child = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "dev", "--port", String(opts.port)], {
    cwd: dir,
    // grupo próprio: o stop encerra o next dev e os processos filhos dele, e só eles
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opts.env, PORT: String(opts.port), NEXT_TELEMETRY_DISABLED: "1" },
  });
  const log: string[] = [];
  child.stdout?.on("data", (d) => log.push(String(d)));
  child.stderr?.on("data", (d) => log.push(String(d)));
  const url = `http://localhost:${opts.port}`;
  const stop = async () => {
    if (child.exitCode !== null || !child.pid) return;
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // já saiu
      }
    }, 10_000);
    await exited;
    clearTimeout(timer);
  };
  try {
    await waitUp(url, child, 180_000);
  } catch (e) {
    await stop();
    throw new Error(`${(e as Error).message}\n${log.join("").slice(-3000)}`);
  }
  return { url, pid: child.pid!, stop };
}

import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const useShell = process.platform === "win32";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

function run(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: useShell,
  });

  if (result.error || result.status !== 0) {
    console.error(failureMessage);
    process.exit(result.status || 1);
  }
}

function commandIsAvailable(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: useShell,
  });

  return !result.error && result.status === 0;
}

function requireCommand(command) {
  if (!commandIsAvailable(command)) {
    console.error(`Missing required command: ${command}`);
    process.exit(1);
  }
}

function copyIfMissing(sourceFile, targetFile) {
  if (existsSync(targetFile)) {
    console.log(`Keeping existing ${targetFile}`);
    return;
  }

  copyFileSync(sourceFile, targetFile);
  console.log(`Created ${targetFile} from ${sourceFile}`);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
  console.error(`Node.js 20 or newer is required; found ${process.version}`);
  process.exit(1);
}

requireCommand("npm");
requireCommand("docker");
requireCommand("ollama");

const npmVersionCheck = spawnSync("npm", ["--version"], {
  encoding: "utf8",
  shell: useShell,
});
const npmMajor = Number.parseInt(
  npmVersionCheck.stdout?.trim().split(".")[0],
  10,
);
if (!Number.isFinite(npmMajor) || npmMajor < 10) {
  console.error(
    `npm 10 or newer is required; found ${npmVersionCheck.stdout?.trim() || "unknown"}`,
  );
  process.exit(1);
}

const dockerCheck = spawnSync("docker", ["info"], {
  stdio: "ignore",
  shell: useShell,
});
if (dockerCheck.error || dockerCheck.status !== 0) {
  console.error(
    "Docker is installed but not running. Start Docker Desktop and retry.",
  );
  process.exit(1);
}

console.log("Installing workspace dependencies...");
run("npm", ["ci"], "Dependency installation failed.");

copyIfMissing("apps/api/.env.example", "apps/api/.env");
copyIfMissing("apps/web/.env.local.example", "apps/web/.env.local");

console.log("Starting PostgreSQL and Redis...");
run("docker", ["compose", "up", "-d"], "Docker services failed to start.");

console.log("Generating Prisma Client...");
run(
  "npx",
  ["prisma", "generate", "--schema", "apps/api/prisma/schema.prisma"],
  "Prisma Client generation failed.",
);

console.log("Applying database migrations...");
run(
  "npx",
  ["prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"],
  "Database migration failed.",
);

console.log("Installing Ollama models...");
run(
  "ollama",
  ["pull", "embeddinggemma"],
  "The Ollama embedding model installation failed.",
);
run(
  "ollama",
  ["pull", "qwen2.5-coder:7b"],
  "The Ollama generation model installation failed.",
);

console.log("\nLocal setup complete.");
console.log("Before starting, replace placeholders in apps/api/.env.");
console.log("Then run: npm run dev");

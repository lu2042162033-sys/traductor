import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";

const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  },
);

let stopping = false;

async function stopServer() {
  if (stopping || server.exitCode !== null) {
    return;
  }
  stopping = true;
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 1000);
  timeout.unref();
  await Promise.race([once(server, "exit"), sleep(1500)]);
  clearTimeout(timeout);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(
        "http://127.0.0.1:4173/traductor/",
      );
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for Vite");
}

process.once("SIGINT", () => {
  void stopServer().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void stopServer().finally(() => process.exit(143));
});

try {
  await waitForServer();
  const tests = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TRADUCTOR_E2E_EXTERNAL_SERVER: "1",
      },
      stdio: "inherit",
    },
  );
  const [code, signal] = await once(tests, "exit");
  if (signal) {
    throw new Error(`Playwright exited with signal ${signal}`);
  }
  process.exitCode = code ?? 1;
} finally {
  await stopServer();
}

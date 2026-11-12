import { spawn, type ChildProcess } from "node:child_process";
import { access, constants, mkdir } from "node:fs/promises";
import net from "node:net";

export interface CoreProcessOptions {
  binPath: string;
  dataDir: string;
  socketPath: string;
  onExit: (message: string) => void;
}

export class CoreProcess {
  private child: ChildProcess | null = null;
  private stopping = false;
  private spawnError: Error | null = null;

  constructor(private readonly options: CoreProcessOptions) {}

  async start(): Promise<void> {
    try {
      await access(
        this.options.binPath,
        process.platform === "win32" ? constants.F_OK : constants.X_OK,
      );
    } catch {
      throw new Error(
        `Core binary not found at ${this.options.binPath}. Build the core first.`,
      );
    }

    await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });

    const child = spawn(
      this.options.binPath,
      [
        "serve",
        "--data-dir",
        this.options.dataDir,
        "--socket",
        this.options.socketPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;

    child.stdout?.on("data", (data: Buffer) => process.stdout.write(`[core] ${data}`));
    child.stderr?.on("data", (data: Buffer) => process.stderr.write(`[core] ${data}`));
    child.once("error", (error) => {
      this.spawnError = error;
    });
    child.on("exit", (code, signal) => {
      if (!this.stopping) {
        this.options.onExit(`Core exited (${signal ?? code ?? "unknown"}).`);
      }
    });

    try {
      await this.waitForSocket(child);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    if (!this.child) {
      return;
    }

    this.stopping = true;
    const child = this.child;
    this.child = null;

    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2000);
    timer.unref();
  }

  private async waitForSocket(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      if (this.spawnError) {
        throw this.spawnError;
      }
      if (child.exitCode !== null) {
        throw new Error("Core exited before its control endpoint was ready.");
      }
      if (await this.controlReady()) {
        return;
      }
      await delay(50);
    }

    throw new Error("Core did not start in time.");
  }

  private controlReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ path: this.options.socketPath });
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(ready);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(250, () => finish(false));
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

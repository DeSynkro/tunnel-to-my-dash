import http from "node:http";
import type {
  CheckResult,
  ConnectResult,
  ProfileInput,
  ProfileSummary,
  SecuritySettings,
  Status,
} from "../shared/types";

export class ControlClient {
  constructor(private readonly socketPath: string) {}

  status(): Promise<Status> {
    return this.request("GET", "/status");
  }

  createVault(password: string): Promise<Status> {
    return this.request("POST", "/vault/create", { password });
  }

  unlock(password: string): Promise<Status> {
    return this.request("POST", "/vault/unlock", { password });
  }

  lock(): Promise<Status> {
    return this.request("POST", "/vault/lock");
  }

  changePassword(oldPassword: string, newPassword: string): Promise<Status> {
    return this.request("POST", "/vault/password", {
      old_password: oldPassword,
      new_password: newPassword,
    });
  }

  updateSecurity(settings: SecuritySettings): Promise<Status> {
    return this.request("PUT", "/security", settings);
  }

  addProfile(input: ProfileInput): Promise<ProfileSummary> {
    return this.request("POST", "/profiles", input);
  }

  updateProfile(id: string, input: ProfileInput): Promise<ProfileSummary> {
    return this.request("PUT", `/profiles/${encodeURIComponent(id)}`, input);
  }

  deleteProfile(id: string): Promise<void> {
    return this.request("DELETE", `/profiles/${encodeURIComponent(id)}`);
  }

  activateProfile(id: string): Promise<Status> {
    return this.request("POST", `/profiles/${encodeURIComponent(id)}/activate`);
  }

  checkProfile(id: string): Promise<CheckResult> {
    return this.request("POST", `/profiles/${encodeURIComponent(id)}/check`);
  }

  connect(id: string): Promise<ConnectResult> {
    return this.request("POST", "/connect", { profile_id: id });
  }

  disconnect(): Promise<Status> {
    return this.request("POST", "/disconnect");
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers:
            data === undefined
              ? undefined
              : {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(data),
                },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = response.statusCode ?? 0;

            if (status >= 200 && status < 300) {
              if (!text) {
                resolve(undefined as T);
                return;
              }
              try {
                resolve(JSON.parse(text) as T);
              } catch {
                reject(new Error("The core returned an invalid response."));
              }
              return;
            }

            let message = "The core rejected the request.";
            try {
              const parsed = JSON.parse(text) as { error?: unknown };
              if (typeof parsed.error === "string") {
                message = parsed.error;
              }
            } catch {
              if (text) {
                message = text;
              }
            }
            reject(new Error(message));
          });
        },
      );

      request.setTimeout(30_000, () => {
        request.destroy(new Error("The core did not respond in time."));
      });
      request.on("error", reject);
      if (data !== undefined) {
        request.write(data);
      }
      request.end();
    });
  }
}

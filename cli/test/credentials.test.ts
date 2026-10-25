import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearCredentials,
  credentialsPath,
  loadCredentials,
  maskKey,
  saveCredentials,
} from "../src/credentials.js";

const KEY = "ksy_live_" + "a".repeat(39) + "wxyz";

function tmpEnv(): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kinsy-cli-"));
  return { KINSY_CONFIG_DIR: path.join(dir, "kinsy") };
}

describe("credentials", () => {
  it("saves 0600 inside a 0700 dir and reloads", () => {
    const env = tmpEnv();
    const file = saveCredentials({ apiKey: KEY, email: "dev@example.com", keyHint: "…wxyz" }, env);
    expect(file).toBe(credentialsPath(env));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const loaded = loadCredentials(env);
    expect(loaded.apiKey).toBe(KEY);
    expect(loaded.source).toBe("file");
    expect(loaded.email).toBe("dev@example.com");
    expect(loaded.apiBase).toBe("https://kinsy.ai");
  });

  it("the environment variable wins over the file", () => {
    const env = tmpEnv();
    saveCredentials({ apiKey: KEY }, env);
    const loaded = loadCredentials({ ...env, KINSY_API_KEY: "ksy_live_fromenv", KINSY_API_BASE: "http://127.0.0.1:9/" });
    expect(loaded.apiKey).toBe("ksy_live_fromenv");
    expect(loaded.source).toBe("env");
    expect(loaded.apiBase).toBe("http://127.0.0.1:9");
  });

  it("reports no credentials when nothing is stored", () => {
    const loaded = loadCredentials(tmpEnv());
    expect(loaded.apiKey).toBeNull();
    expect(loaded.source).toBe("none");
  });

  it("clear removes the file and says whether one existed", () => {
    const env = tmpEnv();
    expect(clearCredentials(env)).toBe(false);
    saveCredentials({ apiKey: KEY }, env);
    expect(clearCredentials(env)).toBe(true);
    expect(fs.existsSync(credentialsPath(env))).toBe(false);
  });

  it("maskKey shows the prefix and the last four characters only", () => {
    expect(maskKey(KEY)).toBe("ksy_live_…wxyz");
    expect(maskKey("short")).toBe("…");
    expect(maskKey(KEY)).not.toContain("a".repeat(8));
  });
});

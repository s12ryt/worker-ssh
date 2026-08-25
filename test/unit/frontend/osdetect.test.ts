import { describe, expect, it } from "vitest";
import { buildDetectCommand, parseDetectOutput } from "@/frontend/osdetect";

const UBUNTU_OUTPUT = [
  "===UNAME===",
  "Linux",
  "5.15.0-91-generic",
  "===OSREL===",
  'PRETTY_NAME="Ubuntu 22.04.3 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="22.04"',
  "ID=ubuntu",
  "ID_LIKE=debian",
  "",
].join("\n");

describe("buildDetectCommand", () => {
  it("包含 uname 與 os-release 讀取", () => {
    const cmd = buildDetectCommand();
    expect(cmd).toContain("uname -s");
    expect(cmd).toContain("uname -r");
    expect(cmd).toContain("/etc/os-release");
    expect(cmd).toContain("===UNAME===");
    expect(cmd).toContain("===OSREL===");
  });
});

describe("parseDetectOutput", () => {
  it("Ubuntu：os=ubuntu、family=linux、distro 取 PRETTY_NAME、version 取 VERSION_ID", () => {
    const info = parseDetectOutput(UBUNTU_OUTPUT, new Date("2026-08-22T00:00:00Z"));
    expect(info).not.toBeNull();
    expect(info!.os).toBe("ubuntu");
    expect(info!.family).toBe("linux");
    expect(info!.distro).toBe("Ubuntu 22.04.3 LTS");
    expect(info!.version).toBe("22.04");
    expect(info!.detectedAt).toBe(new Date("2026-08-22T00:00:00Z").getTime());
  });

  it("未知發行版 ID：os 回退 linux，distro 保留原名", () => {
    const output = [
      "===UNAME===",
      "Linux",
      "6.1.0-generic",
      "===OSREL===",
      'PRETTY_NAME="Deepin 23"',
      "ID=deepin",
    ].join("\n");
    const info = parseDetectOutput(output);
    expect(info!.os).toBe("linux");
    expect(info!.family).toBe("linux");
    expect(info!.distro).toBe("Deepin 23");
  });

  it("別名 ID（rocky）映射到 rockylinux 圖示鍵", () => {
    const output = ["===UNAME===", "Linux", "5.14.0", "===OSREL===", "ID=\"rocky\"", 'VERSION_ID="9.3"'].join("\n");
    const info = parseDetectOutput(output);
    expect(info!.os).toBe("rockylinux");
    expect(info!.version).toBe("9.3");
  });

  it("無 os-release 內容：os=linux、distro/version 為 null", () => {
    const output = ["===UNAME===", "Linux", "4.19.0", "===OSREL===", ""].join("\n");
    const info = parseDetectOutput(output);
    expect(info!.os).toBe("linux");
    expect(info!.distro).toBeUndefined();
    expect(info!.version).toBeUndefined();
  });

  it("Darwin：os=macos、family=darwin、version 取 uname -r", () => {
    const output = ["===UNAME===", "Darwin", "23.5.0", "===OSREL===", "cat: /etc/os-release: No such file or directory"].join("\n");
    const info = parseDetectOutput(output);
    expect(info!.os).toBe("macos");
    expect(info!.family).toBe("darwin");
    expect(info!.version).toBe("23.5.0");
  });

  it("BSD 三兄弟：os 對應小寫、family=bsd", () => {
    for (const [name, id] of [
      ["FreeBSD", "freebsd"],
      ["OpenBSD", "openbsd"],
      ["NetBSD", "netbsd"],
    ] as const) {
      const output = ["===UNAME===", name, "14.0-RELEASE", "===OSREL===", ""].join("\n");
      const info = parseDetectOutput(output);
      expect(info!.os).toBe(id);
      expect(info!.family).toBe("bsd");
    }
  });

  it("空輸出回 null", () => {
    expect(parseDetectOutput("")).toBeNull();
  });

  it("缺少 ===UNAME=== 標記回 null", () => {
    expect(parseDetectOutput("random text\nno markers here")).toBeNull();
  });
});

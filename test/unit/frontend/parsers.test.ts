import { describe, expect, it } from "vitest";
import { parseDarwinMetrics, parseLinuxMetrics, type Metrics } from "@/frontend/parsers";

const LINUX_SAMPLE = [
  "===CPU===",
  "%Cpu(s):  1.7 us,  0.6 sy,  0.0 ni, 97.2 id,  0.3 wa,  0.0 hi,  0.1 si,  0.0 st",
  "",
  "===MEM===",
  "              total        used        free      shared  buff/cache   available",
  "Mem:       16384000     8192000     4096000      131072     4096000     7800000",
  "Swap:       2097152      524288     1572864",
  "",
  "===DISK===",
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "/dev/sda1         40960000  20480000  20480000      51% /",
  "tmpfs              8192000         0   8192000       0% /dev/shm",
  "",
  "===LOAD===",
  "0.10 0.20 0.30 1/234 5678",
  "",
  "===NET===",
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo: 1234567    9876    0    0    0     0          0         0  1234567    9876    0    0    0     0       0          0",
  "  eth0: 1000000000  800000    0    0    0     0          0         0 2000000000  700000    0    0    0     0       0          0",
  "  eth1: 500000000  300000    0    0    0     0          0         0 900000000  400000    0    0    0     0       0          0",
].join("\n");

function expectAllNull(m: Metrics): void {
  for (const [key, value] of Object.entries(m)) {
    expect(value, `欄位 ${key} 應為 null`).toBeNull();
  }
}

describe("parseLinuxMetrics", () => {
  it("完整樣本：解析實體與虛擬記憶體等全部指標", () => {
    const m = parseLinuxMetrics(LINUX_SAMPLE);
    expect(m.cpuPercent).toBeCloseTo(2.8, 5);
    expect(m.memTotal).toBe(16_384_000);
    expect(m.memUsed).toBe(8_192_000);
    expect(m.swapTotal).toBe(2_097_152);
    expect(m.swapUsed).toBe(524_288);
    expect(m.diskTotal).toBe(40_960_000 * 1024); // 40960000 KB → bytes
    expect(m.diskUsed).toBe(20_480_000 * 1024);
    expect(m.load1).toBeCloseTo(0.1, 5);
    expect(m.load5).toBeCloseTo(0.2, 5);
    expect(m.load15).toBeCloseTo(0.3, 5);
    expect(m.netRxBytes).toBe(1_500_000_000); // eth0+eth1，排除 lo
    expect(m.netTxBytes).toBe(2_900_000_000);
  });

  it("Swap 容量為零：保留已知零值而不是未知", () => {
    const m = parseLinuxMetrics("===MEM===\nMem: 1024 512 512\nSwap: 0 0 0");
    expect(m.swapTotal).toBe(0);
    expect(m.swapUsed).toBe(0);
  });

  it("缺少或無效 Swap 行：虛擬記憶體欄位為 null", () => {
    const missing = parseLinuxMetrics("===MEM===\nMem: 1024 512 512");
    expect(missing.swapTotal).toBeNull();
    expect(missing.swapUsed).toBeNull();

    const invalid = parseLinuxMetrics("===MEM===\nSwap: unknown broken values");
    expect(invalid.swapTotal).toBeNull();
    expect(invalid.swapUsed).toBeNull();
  });

  it("缺少 NET 區塊：網路欄位為 null，其餘正常", () => {
    const m = parseLinuxMetrics(LINUX_SAMPLE.split("===NET===")[0]!);
    expect(m.cpuPercent).not.toBeNull();
    expect(m.memTotal).not.toBeNull();
    expect(m.netRxBytes).toBeNull();
    expect(m.netTxBytes).toBeNull();
  });

  it("空字串：全部 null 且不拋錯", () => {
    expectAllNull(parseLinuxMetrics(""));
  });

  it("無關文字（亂碼）：全部 null 且不拋錯", () => {
    expectAllNull(parseLinuxMetrics("hello world\nfoo bar\n"));
  });

  it("CPU idle 為小數：使用率四捨五入到一位小數", () => {
    const m = parseLinuxMetrics("===CPU===\n%Cpu(s):  3.44 us, 91.24 id,  0.1 wa");
    expect(m.cpuPercent).toBeCloseTo(8.8, 5);
  });
});

const DARWIN_SAMPLE = [
  "===CPU===",
  "CPU usage: 5.20% user, 8.10% sys, 86.70% idle",
  "",
  "===MEM===",
  "PhysMem: 6067M used (1522M wired), 3000M unused.",
  "",
  "===MEMTOTAL===",
  "17179869184",
  "",
  "===SWAP===",
  "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M  (encrypted)",
  "",
  "===DISK===",
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "/dev/disk1s1     245107144  98042857 146064287      41% /",
  "",
  "===LOAD===",
  "load averages: 1.50 1.20 0.90",
  "",
  "===NET===",
  "Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll",
  "lo0   16384 <Link#1>                          500000     0   50000000   500000     0   40000000     0",
  "en0    1500 <Link#13>   aabb.ccdd.eeff     12345678     0 12345678901  9876543     0 9876543210     0",
].join("\n");

describe("parseDarwinMetrics", () => {
  it("完整樣本：解析實體與虛擬記憶體等全部指標", () => {
    const m = parseDarwinMetrics(DARWIN_SAMPLE);
    expect(m.cpuPercent).toBeCloseTo(13.3, 5);
    expect(m.memUsed).toBe(6067 * 1024 * 1024);
    expect(m.memTotal).toBe(17_179_869_184);
    expect(m.swapTotal).toBe(4096 * 1024 * 1024);
    expect(m.swapUsed).toBe(512 * 1024 * 1024);
    expect(m.diskTotal).toBe(245_107_144 * 1024);
    expect(m.diskUsed).toBe(98_042_857 * 1024);
    expect(m.load1).toBeCloseTo(1.5, 5);
    expect(m.load5).toBeCloseTo(1.2, 5);
    expect(m.load15).toBeCloseTo(0.9, 5);
    expect(m.netRxBytes).toBe(12_345_678_901); // 排除 lo0
    expect(m.netTxBytes).toBe(9_876_543_210);
  });

  it("Darwin Swap 容量為零：保留已知零值", () => {
    const m = parseDarwinMetrics(
      "===SWAP===\nvm.swapusage: total = 0.00M used = 0.00M free = 0.00M",
    );
    expect(m.swapTotal).toBe(0);
    expect(m.swapUsed).toBe(0);
  });

  it("Darwin／BSD 不支援 swapusage 時優雅降級為 null", () => {
    const m = parseDarwinMetrics("===SWAP===\nsysctl: unknown oid 'vm.swapusage'");
    expect(m.swapTotal).toBeNull();
    expect(m.swapUsed).toBeNull();
  });

  it("PhysMem 支援 G 單位", () => {
    const m = parseDarwinMetrics("===MEM===\nPhysMem: 2G used (512M wired), 6G unused.");
    expect(m.memUsed).toBe(2 * 1024 ** 3);
  });

  it("缺少 MEMTOTAL 區塊：memTotal 為 null，memUsed 正常", () => {
    const m = parseDarwinMetrics(DARWIN_SAMPLE.split("===MEMTOTAL===")[0]! + DARWIN_SAMPLE.split("===LOAD===")[1]!);
    expect(m.memUsed).not.toBeNull();
    expect(m.memTotal).toBeNull();
  });

  it("空字串：全部 null 且不拋錯", () => {
    expectAllNull(parseDarwinMetrics(""));
  });
});

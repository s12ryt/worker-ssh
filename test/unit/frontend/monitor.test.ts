import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDarwinSampleCommand,
  buildLinuxSampleCommand,
  computeNetRate,
  displayMetrics,
  formatBytes,
  formatPercent,
  formatRate,
  parseMetricsFor,
  sampleCommandFor,
  type MetricsSnapshot,
  MetricsPoller,
  SampleBuffer,
} from "@/frontend/monitor";
import { parseLinuxMetrics } from "@/frontend/parsers";

describe("取樣指令組裝", () => {
  it("Linux 指令含全部五個標記區塊", () => {
    const cmd = buildLinuxSampleCommand();
    for (const mark of ["===CPU===", "===MEM===", "===DISK===", "===LOAD===", "===NET==="]) {
      expect(cmd).toContain(`echo ${mark}`);
    }
  });

  it("Linux 指令使用 /proc/loadavg 與 free -b", () => {
    const cmd = buildLinuxSampleCommand();
    expect(cmd).toContain("/proc/loadavg");
    expect(cmd).toContain("free -b");
  });

  it("Darwin 指令含 MEMTOTAL 區塊與 physmem 備援", () => {
    const cmd = buildDarwinSampleCommand();
    expect(cmd).toContain("echo ===MEMTOTAL===");
    expect(cmd).toContain("hw.memsize");
    expect(cmd).toContain("hw.physmem");
  });

  it("Darwin／BSD 指令以獨立區塊取得 swapusage 並允許不支援", () => {
    const cmd = buildDarwinSampleCommand();
    expect(cmd).toContain("echo ===SWAP===");
    expect(cmd).toContain("sysctl vm.swapusage 2>/dev/null");
  });

  it("sampleCommandFor：linux → Linux 指令集", () => {
    expect(sampleCommandFor("linux")).toBe(buildLinuxSampleCommand());
  });

  it("sampleCommandFor：darwin／bsd → Darwin 風格指令集", () => {
    expect(sampleCommandFor("darwin")).toBe(buildDarwinSampleCommand());
    expect(sampleCommandFor("bsd")).toBe(buildDarwinSampleCommand());
  });

  it("sampleCommandFor：未知家族 → Linux 指令集（多數伺服器為 Linux）", () => {
    expect(sampleCommandFor("unknown")).toBe(buildLinuxSampleCommand());
  });
});

describe("parseMetricsFor", () => {
  const LINUX_SAMPLE = [
    "===CPU===",
    "%Cpu(s):  1.7 us,  0.6 sy,  0.0 ni, 97.2 id",
    "===MEM===",
    "Mem:       16384000     8192000     4096000",
    "Swap:        4194304     1048576     3145728",
    "===DISK===",
    "/dev/sda1         40960000  20480000  20480000      51% /",
    "===LOAD===",
    "0.10 0.20 0.30 1/234 5678",
    "===NET===",
    "  eth0: 1000000000  800000    0    0    0     0          0         0 2000000000  700000",
  ].join("\n");

  it("linux 家族 → parseLinuxMetrics", () => {
    const m = parseMetricsFor("linux", LINUX_SAMPLE);
    expect(m.cpuPercent).toBeCloseTo(2.8, 5);
    expect(m.memTotal).toBe(16_384_000);
    expect(m.swapTotal).toBe(4_194_304);
    expect(m.swapUsed).toBe(1_048_576);
  });

  it("darwin 家族 → Darwin 解析器（不誤用 Linux 解析）", () => {
    // Linux 樣本無 Darwin 特徵，Darwin 解析應全 null
    const m = parseMetricsFor("darwin", LINUX_SAMPLE);
    expect(m.cpuPercent).toBeNull();
  });
});

describe("computeNetRate", () => {
  const base: MetricsSnapshot = {
    at: 1_000_000,
    metrics: parseLinuxMetrics(
      ["===NET===", "  eth0: 1000000000 0 0 0 0 0 0 0 2000000000 0"].join("\n"),
    ),
  };

  it("首次取樣（prev=null）→ 速率為 null", () => {
    const cur: MetricsSnapshot = { at: 1_003_000, metrics: base.metrics };
    const r = computeNetRate(null, cur);
    expect(r.rxPerSec).toBeNull();
    expect(r.txPerSec).toBeNull();
  });

  it("正常差值：3 秒內 rx +3000 → 1000 B/s", () => {
    const cur: MetricsSnapshot = {
      at: 1_003_000,
      metrics: parseLinuxMetrics(
        ["===NET===", "  eth0: 1000003000 0 0 0 0 0 0 0 2000006000 0"].join("\n"),
      ),
    };
    const r = computeNetRate(base, cur);
    expect(r.rxPerSec).toBeCloseTo(1000, 5);
    expect(r.txPerSec).toBeCloseTo(2000, 5);
  });

  it("計數器重置（cur < prev）→ null，不出現負速率", () => {
    const cur: MetricsSnapshot = {
      at: 1_003_000,
      metrics: parseLinuxMetrics(
        ["===NET===", "  eth0: 500 0 0 0 0 0 0 0 600 0"].join("\n"),
      ),
    };
    const r = computeNetRate(base, cur);
    expect(r.rxPerSec).toBeNull();
    expect(r.txPerSec).toBeNull();
  });

  it("任一側取樣缺 NET 數據 → null", () => {
    const prevNoNet: MetricsSnapshot = {
      at: 1_000_000,
      metrics: parseLinuxMetrics("===CPU===\n97.2 id"),
    };
    const r = computeNetRate(prevNoNet, base);
    expect(r.rxPerSec).toBeNull();
    expect(r.txPerSec).toBeNull();
  });

  it("時間未前進（elapsed<=0）→ null", () => {
    const r = computeNetRate(base, base);
    expect(r.rxPerSec).toBeNull();
    expect(r.txPerSec).toBeNull();
  });
});

describe("格式化", () => {
  it("formatBytes：二進位單位", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MiB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TiB");
  });

  it("formatRate：附加 /s", () => {
    expect(formatRate(2048)).toBe("2.0 KiB/s");
    expect(formatRate(null)).toBe("--");
  });

  it("formatPercent：一位小數＋%", () => {
    expect(formatPercent(33.33)).toBe("33.3%");
    expect(formatPercent(null)).toBe("--");
  });
});

describe("displayMetrics", () => {
  it("完整指標 → 全欄位有值", () => {
    const m = parseLinuxMetrics(
      [
        "===CPU===",
        "%Cpu(s):  1.7 us,  0.6 sy,  0.0 ni, 97.2 id",
        "===MEM===",
        "Mem:       16384000     8192000     4096000",
        "Swap:        4194304     1048576     3145728",
        "===DISK===",
        "/dev/sda1         40960000  20480000  20480000      51% /",
        "===LOAD===",
        "0.10 0.20 0.30 1/234 5678",
        "===NET===",
        "  eth0: 1000000000 0 0 0 0 0 0 0 2000000000 0",
      ].join("\n"),
    );
    const d = displayMetrics(m, { rxPerSec: 1000, txPerSec: 2000 });
    expect(d.cpu).toBe("2.8%");
    expect(d.memUsed).toBe("7.8 MiB / 15.6 MiB");
    expect(d.memPercent).toBe("50.0%");
    expect(d.swapUsed).toBe("1.0 MiB / 4.0 MiB");
    expect(d.swapPercent).toBe("25.0%");
    expect(d.diskUsed).not.toBe("--");
    expect(d.load).toBe("0.10 / 0.20 / 0.30");
    expect(d.netRx).toBe("1000 B/s");
    expect(d.netTx).toBe("2.0 KiB/s");
  });

  it("null 欄位 → 顯示 --", () => {
    const d = displayMetrics(parseLinuxMetrics(""), { rxPerSec: null, txPerSec: null });
    expect(d.cpu).toBe("--");
    expect(d.memUsed).toBe("--");
    expect(d.memPercent).toBe("--");
    expect(d.swapUsed).toBe("--");
    expect(d.swapPercent).toBe("--");
    expect(d.diskUsed).toBe("--");
    expect(d.load).toBe("--");
    expect(d.netRx).toBe("--");
    expect(d.netTx).toBe("--");
  });

  it("已知未啟用 Swap → 顯示 0 B / 0 B 與 0.0%", () => {
    const m = parseLinuxMetrics("===MEM===\nSwap: 0 0 0");
    const d = displayMetrics(m, { rxPerSec: null, txPerSec: null });
    expect(d.swapUsed).toBe("0 B / 0 B");
    expect(d.swapPercent).toBe("0.0%");
  });
});

describe("SampleBuffer", () => {
  it("新建空緩衝：size=0、values()=[]", () => {
    const buf = new SampleBuffer(60);
    expect(buf.size).toBe(0);
    expect(buf.values()).toEqual([]);
  });

  it("push 少於 capacity 的值 → 按順序返回", () => {
    const buf = new SampleBuffer(60);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.size).toBe(3);
    expect(buf.values()).toEqual([10, 20, 30]);
  });

  it("push 超過 capacity → 環形覆蓋最舊，只保留最後 capacity 個", () => {
    const buf = new SampleBuffer(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // 覆蓋 1
    buf.push(5); // 覆蓋 2
    expect(buf.size).toBe(3);
    expect(buf.values()).toEqual([3, 4, 5]);
  });

  it("push null 值保留（chart.js 顯示 gap）", () => {
    const buf = new SampleBuffer(60);
    buf.push(10);
    buf.push(null);
    buf.push(30);
    expect(buf.values()).toEqual([10, null, 30]);
  });

  it("clear → 清空緩衝", () => {
    const buf = new SampleBuffer(60);
    buf.push(10);
    buf.push(20);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.values()).toEqual([]);
  });

  it("capacity=60 → 可連續 push 100 個值仍只保留最後 60 個", () => {
    const buf = new SampleBuffer(60);
    for (let i = 0; i < 100; i++) buf.push(i);
    expect(buf.size).toBe(60);
    const vals = buf.values();
    expect(vals[0]).toBe(40);
    expect(vals[59]).toBe(99);
    expect(vals.length).toBe(60);
  });
});

describe("MetricsPoller 動態頻率", () => {
  afterEach(() => vi.useRealTimers());

  it("執行中更新間隔會停止舊 timer 並以新間隔重新排程", async () => {
    vi.useFakeTimers();
    const sample = vi.fn(async () => "");
    const poller = new MetricsPoller({
      family: "linux",
      sample,
      onSample: vi.fn(),
      onError: vi.fn(),
      intervalMs: 3_000,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(3_000);
    const before = sample.mock.calls.length;
    poller.setIntervalMs(10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sample.mock.calls.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sample.mock.calls.length).toBe(before + 2);
    poller.stop();
  });
});

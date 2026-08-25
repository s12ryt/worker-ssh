// 監控模組：取樣指令組裝、速率差值計算與顯示格式化
// 純函式部分集中於此（可測）；輪詢排程見 monitor.ts 底部 Poller（膠水層）
import {
  parseDarwinMetrics,
  parseLinuxMetrics,
  type Metrics,
} from "./parsers";

// ---- 取樣指令組裝 ----

/** Linux 取樣指令（標記區塊對應 parsers.splitSections） */
export function buildLinuxSampleCommand(): string {
  return [
    "echo ===CPU===",
    "top -bn1 | head -8",
    "echo ===MEM===",
    "free -b",
    "echo ===DISK===",
    "df -kP /",
    "echo ===LOAD===",
    "cat /proc/loadavg",
    "echo ===NET===",
    "cat /proc/net/dev",
  ].join("; ");
}

/**
 * Darwin／BSD 風格取樣指令。
 * BSD 家族依 D13 共用此指令集；不支援的指令以 2>/dev/null 或解析失敗優雅降級為 --。
 */
export function buildDarwinSampleCommand(): string {
  return [
    "echo ===CPU===",
    "top -l 1 | head -10",
    "echo ===MEM===",
    "top -l 1 | grep PhysMem",
    "echo ===MEMTOTAL===",
    "sysctl -n hw.memsize 2>/dev/null || sysctl -n hw.physmem 2>/dev/null",
    "echo ===SWAP===",
    "sysctl vm.swapusage 2>/dev/null",
    "echo ===DISK===",
    "df -kP /",
    "echo ===LOAD===",
    "uptime",
    "echo ===NET===",
    "netstat -ib",
  ].join("; ");
}

/** 依 OS 家族選擇取樣指令集 */
export function sampleCommandFor(family: string): string {
  return family === "darwin" || family === "bsd"
    ? buildDarwinSampleCommand()
    : buildLinuxSampleCommand();
}

/** 依 OS 家族選擇解析器 */
export function parseMetricsFor(family: string, output: string): Metrics {
  return family === "darwin" || family === "bsd"
    ? parseDarwinMetrics(output)
    : parseLinuxMetrics(output);
}

// ---- 速率差值計算 ----

/** 帶時間戳的指標取樣 */
export interface MetricsSnapshot {
  metrics: Metrics;
  /** 取樣時間（ms epoch） */
  at: number;
}

export interface NetRate {
  rxPerSec: number | null;
  txPerSec: number | null;
}

/**
 * 由前後兩次取樣計算網路速率（bytes/sec）。
 * 首次取樣、缺數據、時間未前進或計數器重置 → null。
 */
export function computeNetRate(
  prev: MetricsSnapshot | null,
  cur: MetricsSnapshot,
): NetRate {
  if (
    prev === null ||
    prev.metrics.netRxBytes === null ||
    prev.metrics.netTxBytes === null ||
    cur.metrics.netRxBytes === null ||
    cur.metrics.netTxBytes === null
  ) {
    return { rxPerSec: null, txPerSec: null };
  }
  const elapsedSec = (cur.at - prev.at) / 1000;
  if (elapsedSec <= 0) return { rxPerSec: null, txPerSec: null };

  const rxDelta = cur.metrics.netRxBytes - prev.metrics.netRxBytes;
  const txDelta = cur.metrics.netTxBytes - prev.metrics.netTxBytes;
  // 計數器重置（介面重啟等）不出現負速率
  const rxPerSec = rxDelta < 0 ? null : rxDelta / elapsedSec;
  const txPerSec = txDelta < 0 ? null : txDelta / elapsedSec;
  return { rxPerSec, txPerSec };
}

// ---- 格式化 ----

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** 位元組 → 人類可讀二進位單位字串 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "--";
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${(Math.round(value * 10) / 10).toFixed(1)} ${UNITS[unit]}`;
}

/** 速率字串（bytes/s） */
export function formatRate(bytesPerSec: number | null): string {
  return bytesPerSec === null ? "--" : `${formatBytes(bytesPerSec)}/s`;
}

/** 百分比字串（一位小數） */
export function formatPercent(p: number | null): string {
  return p === null ? "--" : `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}

function fmtLoad(v: number | null): string {
  return v === null ? "--" : v.toFixed(2);
}

/** 監控面板各欄位的顯示字串 */
export interface MetricsDisplay {
  cpu: string;
  memUsed: string;
  memPercent: string;
  swapUsed: string;
  swapPercent: string;
  diskUsed: string;
  diskPercent: string;
  load: string;
  netRx: string;
  netTx: string;
}

/** 指標＋網路速率 → 面板顯示字串（null 一律 --） */
export function displayMetrics(m: Metrics, rate: NetRate): MetricsDisplay {
  const memPercent =
    m.memTotal !== null && m.memUsed !== null && m.memTotal > 0
      ? formatPercent((m.memUsed / m.memTotal) * 100)
      : "--";
  const diskPercent =
    m.diskTotal !== null && m.diskUsed !== null && m.diskTotal > 0
      ? formatPercent((m.diskUsed / m.diskTotal) * 100)
      : "--";
  const swapTotal = m.swapTotal;
  const swapUsed = m.swapUsed;
  const swapKnown = swapTotal !== null && swapUsed !== null;
  const swapPercent = swapKnown
    ? swapTotal === 0
      ? swapUsed === 0
        ? "0.0%"
        : "--"
      : formatPercent((swapUsed / swapTotal) * 100)
    : "--";
  const load =
    m.load1 !== null && m.load5 !== null && m.load15 !== null
      ? `${fmtLoad(m.load1)} / ${fmtLoad(m.load5)} / ${fmtLoad(m.load15)}`
      : "--";
  return {
    cpu: formatPercent(m.cpuPercent),
    memUsed:
      m.memUsed === null ? "--" : `${formatBytes(m.memUsed)} / ${formatBytes(m.memTotal ?? 0)}`,
    memPercent,
    swapUsed: swapKnown
      ? `${formatBytes(swapUsed)} / ${formatBytes(swapTotal)}`
      : "--",
    swapPercent,
    diskUsed:
      m.diskUsed === null ? "--" : `${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal ?? 0)}`,
    diskPercent,
    load,
    netRx: formatRate(rate.rxPerSec),
    netTx: formatRate(rate.txPerSec),
  };
}

// ---- 取樣緩衝（純邏輯，TDD） ----

/**
 * 環形取樣緩衝：保留最近 N 個樣本（3 秒輪詢 × 60 點 = 3 分鐘歷史）。
 * 用於 chart.js sparkline 渲染；null 值保留（chart.js 顯示為 gap）。
 */
export class SampleBuffer {
  private readonly buf: (number | null)[] = [];
  private readonly cap: number;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`SampleBuffer capacity 必須為正有限數，收到 ${capacity}`);
    }
    this.cap = Math.floor(capacity);
  }

  /** 目前樣本數（<= capacity） */
  get size(): number {
    return this.buf.length;
  }

  /** 加入新樣本（null 表示該時段無數據，chart.js 渲染為 gap） */
  push(value: number | null): void {
    this.buf.push(value);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  /** 返回目前所有樣本（按時間順序，最舊→最新）的副本 */
  values(): (number | null)[] {
    return [...this.buf];
  }

  /** 清空緩衝 */
  clear(): void {
    this.buf.length = 0;
  }
}

// ---- 輪詢排程（膠水層，編譯驗證） ----

export interface PollerDeps {
  /** OS 家族（決定取樣指令與解析器） */
  family: string;
  /** 執行取樣指令並回傳輸出 */
  sample(command: string): Promise<string>;
  /** 每次成功取樣的回呼 */
  onSample(display: MetricsDisplay): void;
  /** 每次成功取樣的原始 snapshot 回呼（供 chart.js sparkline 渲染） */
  onSnapshot?: (snapshot: MetricsSnapshot) => void;
  /** 取樣失敗回呼（不中斷輪詢） */
  onError(err: unknown): void;
  /** 輪詢間隔 ms，預設 3000 */
  intervalMs?: number;
}

/** 固定間隔指標輪詢器；取樣重疊時略過該輪，stop 後不再觸發 */
export class MetricsPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prev: MetricsSnapshot | null = null;
  private busy = false;
  private running = false;
  private intervalMs: number;

  constructor(private readonly deps: PollerDeps) {
    this.intervalMs = deps.intervalMs ?? 3000;
  }

  start(): void {
    this.clearTimer();
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  setIntervalMs(intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("監控輪詢間隔必須為正數");
    }
    const wasRunning = this.running;
    this.clearTimer();
    this.intervalMs = intervalMs;
    if (wasRunning) {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const output = await this.deps.sample(sampleCommandFor(this.deps.family));
      const snapshot: MetricsSnapshot = {
        metrics: parseMetricsFor(this.deps.family, output),
        at: Date.now(),
      };
      const rate = computeNetRate(this.prev, snapshot);
      this.prev = snapshot;
      this.deps.onSnapshot?.(snapshot);
      this.deps.onSample(displayMetrics(snapshot.metrics, rate));
    } catch (err) {
      this.deps.onError(err);
    } finally {
      this.busy = false;
    }
  }
}

// ---- 圖表渲染（膠水層，編譯驗證 + E2E） ----

export interface MonitorChartsHandle {
  /** 從 Metrics 提取百分比 push 到各 sparkline 緩衝並更新圖表 */
  push(metrics: Metrics): void;
  /** 銷毀所有 Chart 實例（teardown 時呼叫） */
  destroy(): void;
}

/** sparkline 最大取樣點數（3 秒輪詢 × 60 點 = 3 分鐘歷史） */
const CHART_CAPACITY = 60;

/** 從 Metrics 提取 CPU/記憶體/磁碟 百分比（null 表示無數據） */
function extractPercents(m: Metrics): {
  cpu: number | null;
  mem: number | null;
  disk: number | null;
} {
  const mem =
    m.memTotal !== null && m.memUsed !== null && m.memTotal > 0
      ? (m.memUsed / m.memTotal) * 100
      : null;
  const disk =
    m.diskTotal !== null && m.diskUsed !== null && m.diskTotal > 0
      ? (m.diskUsed / m.diskTotal) * 100
      : null;
  return { cpu: m.cpuPercent, mem, disk };
}

/**
 * 建立 CPU/記憶體/磁碟 三條 sparkline 圖表。
 * chart.js 動態載入（連線後預載，與 terminal chunk 同為延遲載入）。
 */
export async function createMonitorCharts(
  cpuCanvas: HTMLCanvasElement,
  memCanvas: HTMLCanvasElement,
  diskCanvas: HTMLCanvasElement,
): Promise<MonitorChartsHandle> {
  const { Chart } = await import("chart.js/auto");
  const cpuBuf = new SampleBuffer(CHART_CAPACITY);
  const memBuf = new SampleBuffer(CHART_CAPACITY);
  const diskBuf = new SampleBuffer(CHART_CAPACITY);

  /** 建立單條 sparkline 圖表（無軸無標籤，即時更新無動畫） */
  const makeChart = (
    canvas: HTMLCanvasElement,
    buf: SampleBuffer,
    color: string,
  ): InstanceType<typeof Chart> =>
    new Chart(canvas, {
      type: "line",
      data: {
        labels: Array.from({ length: CHART_CAPACITY }, (_, i) => i),
        datasets: [
          {
            data: buf.values() as (number | null)[],
            borderColor: color,
            backgroundColor: color + "22", // 半透明填充
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 100 },
        },
      },
    });

  const cpuChart = makeChart(cpuCanvas, cpuBuf, "#7dd3fc"); // CPU 淡藍
  const memChart = makeChart(memCanvas, memBuf, "#c4b5fd"); // 記憶體 淺紫
  const diskChart = makeChart(diskCanvas, diskBuf, "#86efac"); // 磁碟 淺綠

  return {
    push(metrics: Metrics): void {
      const { cpu, mem, disk } = extractPercents(metrics);
      cpuBuf.push(cpu);
      memBuf.push(mem);
      diskBuf.push(disk);
      cpuChart.data.datasets[0]!.data = cpuBuf.values() as (number | null)[];
      memChart.data.datasets[0]!.data = memBuf.values() as (number | null)[];
      diskChart.data.datasets[0]!.data = diskBuf.values() as (number | null)[];
      cpuChart.update("none");
      memChart.update("none");
      diskChart.update("none");
    },
    destroy(): void {
      cpuChart.destroy();
      memChart.destroy();
      diskChart.destroy();
    },
  };
}

// 指標輸出解析器（純函式，可測）
// 輸入為 monitor.ts 組合的標記區塊文字（===CPU=== / ===MEM=== / ...）

/** 單次取樣的系統指標；無法解析的欄位為 null */
export interface Metrics {
  /** CPU 使用率（%，0–100） */
  cpuPercent: number | null;
  /** 記憶體總量（bytes） */
  memTotal: number | null;
  /** 已用記憶體（bytes） */
  memUsed: number | null;
  /** 交換空間總量（bytes）；null 表示無法取得，0 表示已知未啟用 */
  swapTotal: number | null;
  /** 已用交換空間（bytes）；null 表示無法取得 */
  swapUsed: number | null;
  /** 根分割區總量（bytes） */
  diskTotal: number | null;
  /** 根分割區已用（bytes） */
  diskUsed: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  /** 網路累計接收位元組（所有非 lo 介面加總） */
  netRxBytes: number | null;
  /** 網路累計傳送位元組（所有非 lo 介面加總） */
  netTxBytes: number | null;
}

const NULL_METRICS: Metrics = {
  cpuPercent: null,
  memTotal: null,
  memUsed: null,
  swapTotal: null,
  swapUsed: null,
  diskTotal: null,
  diskUsed: null,
  load1: null,
  load5: null,
  load15: null,
  netRxBytes: null,
  netTxBytes: null,
};

/** 依 ===KEY=== 標記切分區塊 */
function splitSections(output: string): Map<string, string> {
  const sections = new Map<string, string>();
  const re = /^===([A-Z]+)===$/gm;
  let match: RegExpExecArray | null;
  const marks: Array<{ key: string; start: number; end: number }> = [];
  while ((match = re.exec(output)) !== null) {
    marks.push({ key: match[1]!, start: match.index, end: re.lastIndex });
  }
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]!;
    const nextStart = i + 1 < marks.length ? marks[i + 1]!.start : output.length;
    sections.set(cur.key, output.slice(cur.end, nextStart));
  }
  return sections;
}

/** 由任意文字中擷取第一個數字（含小數） */
function firstNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 四捨五入到一位小數 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 解析 df -kP 輸出：取掛載點為「/」的行（KB → bytes） */
function parseDisk(section: string | undefined): { total: number | null; used: number | null } {
  if (!section) return { total: null, used: null };
  for (const line of section.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 6 && cols[cols.length - 1] === "/") {
      const total = Number(cols[1]);
      const used = Number(cols[2]);
      if (Number.isFinite(total) && Number.isFinite(used)) {
        return { total: total * 1024, used: used * 1024 };
      }
      return { total: null, used: null };
    }
  }
  return { total: null, used: null };
}

/** 解析 Linux（top/free/df/loadavg/net/dev）取樣輸出 */
export function parseLinuxMetrics(output: string): Metrics {
  const m: Metrics = { ...NULL_METRICS };
  const sections = splitSections(output);

  // CPU：top 的 %Cpu(s) 行，取 idle 值 → 100 - idle
  const cpu = sections.get("CPU");
  if (cpu) {
    const idleMatch = cpu.match(/([\d.]+)\s*id(?:le)?\b/);
    if (idleMatch) m.cpuPercent = round1(100 - Number(idleMatch[1]));
  }

  // MEM：free -b 的 Mem:/Swap: 行 → 第 2 欄 total、第 3 欄 used
  const mem = sections.get("MEM");
  if (mem) {
    for (const line of mem.split("\n")) {
      const trimmed = line.trim();
      const cols = trimmed.split(/\s+/);
      if (/^Mem:/i.test(trimmed)) {
        const total = Number(cols[1]);
        const used = Number(cols[2]);
        if (Number.isFinite(total)) m.memTotal = total;
        if (Number.isFinite(used)) m.memUsed = used;
      } else if (/^Swap:/i.test(trimmed)) {
        const total = Number(cols[1]);
        const used = Number(cols[2]);
        if (Number.isFinite(total) && Number.isFinite(used)) {
          m.swapTotal = total;
          m.swapUsed = used;
        }
      }
    }
  }

  // DISK
  const disk = parseDisk(sections.get("DISK"));
  m.diskTotal = disk.total;
  m.diskUsed = disk.used;

  // LOAD：/proc/loadavg 前三個數
  const load = sections.get("LOAD");
  if (load) {
    const nums = load.trim().match(/^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (nums) {
      m.load1 = Number(nums[1]);
      m.load5 = Number(nums[2]);
      m.load15 = Number(nums[3]);
    }
  }

  // NET：/proc/net/dev，排除 lo 與表頭，rx=冒號後第 1 欄、tx=第 9 欄
  const net = sections.get("NET");
  if (net) {
    let rxSum = 0;
    let txSum = 0;
    for (const line of net.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const iface = line.slice(0, colon).trim();
      if (!iface || iface === "lo") continue;
      const cols = line.slice(colon + 1).trim().split(/\s+/);
      const rx = Number(cols[0]);
      const tx = Number(cols[8]);
      if (Number.isFinite(rx)) rxSum += rx;
      if (Number.isFinite(tx)) txSum += tx;
    }
    if (rxSum > 0 || txSum > 0) {
      m.netRxBytes = rxSum;
      m.netTxBytes = txSum;
    }
  }

  return m;
}

/** K/M/G/T 單位 → bytes */
function unitToBytes(value: number, unit: string): number {
  switch (unit.toUpperCase()) {
    case "K":
      return value * 1024;
    case "M":
      return value * 1024 ** 2;
    case "G":
      return value * 1024 ** 3;
    case "T":
      return value * 1024 ** 4;
    default:
      return value;
  }
}

/** 解析 macOS（top/physMem/sysctl/df/netstat）取樣輸出 */
export function parseDarwinMetrics(output: string): Metrics {
  const m: Metrics = { ...NULL_METRICS };
  const sections = splitSections(output);

  // CPU：CPU usage: x% user, y% sys, z% idle → user + sys
  const cpu = sections.get("CPU");
  if (cpu) {
    const cm = cpu.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/i);
    if (cm) m.cpuPercent = round1(Number(cm[1]) + Number(cm[2]));
  }

  // MEM：PhysMem: 6067M used → bytes；總量來自 MEMTOTAL（sysctl hw.memsize）
  const mem = sections.get("MEM");
  if (mem) {
    const pm = mem.match(/PhysMem:\s*([\d.]+)\s*([KMGT])\s*used/i);
    if (pm) m.memUsed = Math.round(unitToBytes(Number(pm[1]), pm[2]!));
  }
  const memTotalSection = sections.get("MEMTOTAL");
  if (memTotalSection) {
    const total = firstNumber(memTotalSection);
    if (total !== null) m.memTotal = total;
  }

  // SWAP：macOS sysctl vm.swapusage 的 total/used；BSD 不支援時維持 null。
  const swap = sections.get("SWAP");
  if (swap) {
    const sm = swap.match(
      /total\s*=\s*([\d.]+)\s*([KMGT]?)\s+used\s*=\s*([\d.]+)\s*([KMGT]?)/i,
    );
    if (sm) {
      const total = unitToBytes(Number(sm[1]), sm[2] || "B");
      const used = unitToBytes(Number(sm[3]), sm[4] || "B");
      if (Number.isFinite(total) && Number.isFinite(used)) {
        m.swapTotal = Math.round(total);
        m.swapUsed = Math.round(used);
      }
    }
  }

  // DISK
  const disk = parseDisk(sections.get("DISK"));
  m.diskTotal = disk.total;
  m.diskUsed = disk.used;

  // LOAD：load averages: a b c
  const load = sections.get("LOAD");
  if (load) {
    const lm = load.match(/load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (lm) {
      m.load1 = Number(lm[1]);
      m.load5 = Number(lm[2]);
      m.load15 = Number(lm[3]);
    }
  }

  // NET：netstat -ib 含 <Link# 的行，欄 6=Ibytes、欄 9=Obytes，排除 lo*
  const net = sections.get("NET");
  if (net) {
    let rxSum = 0;
    let txSum = 0;
    for (const line of net.split("\n")) {
      if (!line.includes("<Link#")) continue;
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10 || /^lo/i.test(cols[0]!)) continue;
      const rx = Number(cols[6]);
      const tx = Number(cols[9]);
      if (Number.isFinite(rx)) rxSum += rx;
      if (Number.isFinite(tx)) txSum += tx;
    }
    if (rxSum > 0 || txSum > 0) {
      m.netRxBytes = rxSum;
      m.netTxBytes = txSum;
    }
  }

  return m;
}

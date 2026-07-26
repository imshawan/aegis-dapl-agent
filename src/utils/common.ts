import os from 'os';

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function getSystemLoad(): string {
  if (process.platform === 'win32') {
    // Measure total CPU tick usage across all cores
    const cpus = os.cpus();
    let user = 0, sys = 0, idle = 0;
    
    for (const cpu of cpus) {
      user += cpu.times.user;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
    }
    
    const total = user + sys + idle;
    const usedPct = Math.round(((total - idle) / total) * 100);
    return `CPU Usage: ${usedPct}% (Windows)`;
  }

  const [m1, m5, m15] = os.loadavg().map(n => n.toFixed(2));
  return `1m: ${m1} | 5m: ${m5} | 15m: ${m15}`;
}
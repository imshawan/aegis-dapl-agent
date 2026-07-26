import React from 'react';

export interface SystemInfoProps {
  hostname?: string;
  osRelease?: string;
  nodeVersion?: string;
  v8Version?: string;
  pid?: number;
  cpuModel?: string;
  cpuCores?: number;
  loadAvg?: string;
  daemonUptime?: string;
  osUptime?: string;
  rssMemory?: string;
  heapMemory?: string;
  sysMemory?: string;
  activeKeysCount?: number;
  environment?: string;
  isAuthorized?: boolean;
}

export const SystemInfoGrid: React.FC<SystemInfoProps> = ({
  hostname = 'aegis-agent',
  osRelease = 'Darwin arm64',
  nodeVersion = 'v22.0.0',
  v8Version = 'V8',
  pid = 1,
  cpuModel = 'Apple M8',
  cpuCores = 16,
  loadAvg = '0.00, 0.00, 0.00',
  daemonUptime = '0m 0s',
  osUptime = '0m 0s',
  rssMemory = '0 MB',
  heapMemory = '0 MB / 0 MB',
  sysMemory = '0 GB Free',
  activeKeysCount = -1,
  environment = 'production',
  isAuthorized = false,
}) => {
  if (!isAuthorized) {
    return null;
  }

  return (
    <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
      <div className="daemon-title" style={{ color: '#16a34a', marginBottom: '0.75rem', fontSize: '13px' }}>
        Authorized SRE Session Diagnostics
      </div>
      <div className="status-grid" style={{ marginBottom: 0 }}>
        <div className="row"><span className="key">Host:</span><span className="val">{hostname} (PID: {pid})</span></div>
        <div className="row"><span className="key">OS:</span><span className="val">{osRelease}</span></div>
        <div className="row"><span className="key">Kernel:</span><span className="val">Node.js {nodeVersion} (V8: {v8Version})</span></div>
        <div className="row"><span className="key">Uptime:</span><span className="val">Agent: {daemonUptime} (Host: {osUptime})</span></div>
        <div className="row"><span className="key">Shell:</span><span className="val">{cpuCores}x {cpuModel} [Load Avg: {loadAvg}]</span></div>
        <div className="row"><span className="key">Services:</span><span className="val">Sentry APM, Slack, Custom Webhooks</span></div>
        <div className="row"><span className="key">Security:</span><span className="val">AccessKey Header Auth ({activeKeysCount} keys loaded)</span></div>
        <div className="row"><span className="key">Memory:</span><span className="val">RSS: {rssMemory} | Heap: {heapMemory} | {sysMemory}</span></div>
      </div>
    </div>
  );
};

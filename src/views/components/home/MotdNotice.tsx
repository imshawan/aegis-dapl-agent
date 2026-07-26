import React from 'react';

export interface MotdNoticeProps {
  isAuthorized?: boolean;
  daemonUptime?: string;
  appName?: string;
  appVersion?: string;
  appDescription?: string;
  completedJobsCount?: number;
}

export const MotdNotice: React.FC<MotdNoticeProps> = ({
  daemonUptime = '14d 6h 32m (Active Ingress)',
  appName = 'aegis-dapl-agent',
  appVersion = '1.0.0',
  appDescription = 'Aegis (aegis-dapl-agent) - Dynamic Agentic Planning Loop Autonomous SRE Incident Orchestrator',
  completedJobsCount = 0,
}) => {
  return (
    <div>
      <div className="daemon-header">
        <span className="daemon-title">{appName} v{appVersion}</span>
        <span className="daemon-sub">&bull; {appDescription}</span>
      </div>

      <div className="separator">-------------------------------------------------------</div>

      <div className="status-grid">
        <div className="row"><span className="key">Status:</span><span className="val ok">🟢 ONLINE (Port 3000)</span></div>
        <div className="row"><span className="key">Uptime:</span><span className="val">{daemonUptime}</span></div>
        <div className="row"><span className="key">Ingress:</span><span className="val">POST /api/v1/webhooks/&#123;sentry,slack,generic&#125;</span></div>
        <div className="row"><span className="key">Completed:</span><span className="val">{`${completedJobsCount} jobs`}</span></div>
      </div>

      <div className="welcome-text">
        <p>Welcome to Aegis! If you see this page, the autonomous SRE agent is successfully installed and working.</p>
        <p style={{ marginTop: '0.75rem' }}>For online documentation and support please refer to <a href="https://github.com/imshawan/aegis-dapl-agent#readme">aegis-dapl-agent documentation</a>.</p>
        <p className="thank-you">Thank you for using Aegis.</p>
      </div>
    </div>
  );
};

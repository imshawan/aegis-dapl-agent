import React from 'react';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { AccessKeyService } from '@/security/accessKeyService';
import {
  homeStyles,
  TerminalWindow,
  AsciiBanner,
  SystemInfoGrid,
  MotdNotice,
  SystemInfoProps,
} from '@/views/components/home';

export interface HomePageProps extends SystemInfoProps {
  loginText?: string;
  userHost?: string;
  isAuthorized?: boolean;
  appName?: string;
  appVersion?: string;
  appDescription?: string;
  completedJobsCount?: number;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

function getPackageMetadata() {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return {
        name: pkg.name || 'aegis-dapl-agent',
        version: pkg.version || '1.0.0',
        description: pkg.description || 'Dynamic Agentic Planning Loop Autonomous SRE Incident Orchestrator',
      };
    }
  } catch {
    // Silent fallback
  }
  return {
    name: 'aegis-dapl-agent',
    version: '1.0.0',
    description: 'Dynamic Agentic Planning Loop Autonomous SRE Incident Orchestrator',
  };
}

export function computeRealDiagnostics(customProps?: Partial<HomePageProps>): HomePageProps {
  if (customProps && Object.keys(customProps).length > 0 && customProps.hostname && customProps.osRelease !== undefined) {
    return customProps as HomePageProps;
  }

  const pkgMeta = getPackageMetadata();
  const appName = customProps?.appName ?? pkgMeta.name;
  const appVersion = customProps?.appVersion ?? pkgMeta.version;
  const appDescription = customProps?.appDescription ?? pkgMeta.description;

  const isAuthorized = customProps?.isAuthorized ?? false;
  const hostname = isAuthorized ? os.hostname() : 'aegis-agent';
  const now = new Date().toUTCString();
  const uptimeStr = formatUptime(process.uptime());

  if (!isAuthorized) {
    return {
      hostname: 'aegis-agent',
      osRelease: 'Aegis SRE Linux x86_64',
      nodeVersion: 'Node.js 22.x LTS (V8 Engine)',
      v8Version: 'V8 Engine',
      pid: 1,
      cpuModel: 'Aegis Webhook Ingress Console',
      cpuCores: 1,
      loadAvg: '0.00, 0.00, 0.00',
      daemonUptime: uptimeStr,
      osUptime: 'Continuous',
      rssMemory: 'Dynamic LFU Cache (Redis)',
      heapMemory: '0 MB / 0 MB',
      sysMemory: '0 GB Free',
      activeKeysCount: -1,
      environment: process.env.NODE_ENV || 'production',
      loginText: `Last login: ${now} on pts/0`,
      userHost: 'root@aegis-agent',
      isAuthorized: false,
      appName,
      appVersion,
      appDescription,
      ...customProps,
    };
  }

  const cpus = os.cpus();
  const cpuModel = cpus && cpus.length > 0 ? cpus[0].model.trim() : 'Unknown CPU';
  const memUsage = process.memoryUsage();
  const rssMemory = `${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`;
  const heapMemory = `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`;
  const sysMemory = `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB Free / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB Total`;
  const loadAvg = os.loadavg().map(n => n.toFixed(2)).join(', ');
  const osRelease = `${os.type()} ${os.release()} (${os.arch()})`;
  const activeKeysCount = AccessKeyService.listKeys ? AccessKeyService.listKeys().length : 0;

  return {
    hostname,
    osRelease,
    nodeVersion: process.version,
    v8Version: process.versions.v8 || 'V8',
    pid: process.pid,
    cpuModel,
    cpuCores: cpus.length,
    loadAvg,
    daemonUptime: uptimeStr,
    osUptime: formatUptime(os.uptime()),
    rssMemory,
    heapMemory,
    sysMemory,
    activeKeysCount,
    environment: process.env.NODE_ENV || 'development',
    loginText: `Last login: ${now} on pts/0 (authorized-sre-session)`,
    userHost: `root@${hostname}`,
    isAuthorized: true,
    appName,
    appVersion,
    appDescription,
    ...customProps,
  };
}

export const HomePageComponent: React.FC<HomePageProps> = (props) => {
  const finalProps = computeRealDiagnostics(props);
  const { isAuthorized, daemonUptime, appName, appVersion, appDescription } = finalProps;
  const titleText = `${appName || 'aegis-dapl-agent'} • SRE Gateway`;

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{titleText}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: homeStyles }} />
      </head>
      <body>
        <TerminalWindow isAuthorized={isAuthorized}>
          <AsciiBanner />
          <MotdNotice
            isAuthorized={isAuthorized}
            daemonUptime={daemonUptime}
            appName={appName}
            appVersion={appVersion}
            appDescription={appDescription}
            completedJobsCount={props.completedJobsCount}
          />
          <SystemInfoGrid {...finalProps} />
        </TerminalWindow>
      </body>
    </html>
  );
};

export function getHomePageHtml(props: HomePageProps = {}): string {
  const rendered = renderToString(<HomePageComponent {...props} />);
  return `<!DOCTYPE html>${rendered}`;
}

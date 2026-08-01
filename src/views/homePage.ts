import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getAegisAsciiArt } from '@/utils/ascii';
export interface HomePageProps {
  daemonUptime?: string;
  osUptime?: string;
  isAuthorized?: boolean;
  appName?: string;
  appVersion?: string;
  appDescription?: string;
  completedJobsCount?: number;
  now?: string;
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

export function getPackageMetadata() {
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

function getSystemAwareTimestamp(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const timeStr = d.toString().replace(/\s*\([^)]*\)/, '').trim();
  return `${timeStr} [${tz}]`;
}

export function computeRealDiagnostics(customProps?: Partial<HomePageProps>): HomePageProps {
  const pkgMeta = getPackageMetadata();
  const appName = customProps?.appName ?? pkgMeta.name;
  const appVersion = customProps?.appVersion ?? pkgMeta.version;
  const appDescription = customProps?.appDescription ?? pkgMeta.description;

  const isAuthorized = customProps?.isAuthorized ?? false;
  const now = customProps?.now ?? getSystemAwareTimestamp();
  const uptimeStr = formatUptime(process.uptime());

  return {
    daemonUptime: uptimeStr,
    osUptime: formatUptime(os.uptime()),
    appName,
    appVersion,
    appDescription,
    now,
    ...customProps,
  };
}

let cachedTemplate: string | null = null;

function getTemplateContent(): string {
  if (cachedTemplate && process.env.NODE_ENV === 'production') {
    return cachedTemplate;
  }

  const possiblePaths = [
    path.resolve(__dirname, 'homePage.html'),
    path.resolve(process.cwd(), 'src/views/homePage.html'),
    path.resolve(process.cwd(), 'dist/views/homePage.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      cachedTemplate = fs.readFileSync(p, 'utf8');
      return cachedTemplate;
    }
  }

  throw new Error('homePage.html template not found');
}

export function getHomePageHtml(props: HomePageProps = {}): string {
  const finalProps = computeRealDiagnostics(props);
  const {
    daemonUptime = '0s',
    appName = 'aegis-dapl-agent',
    appVersion = '1.0.0',
    appDescription = '',
    completedJobsCount = 0,
    now = getSystemAwareTimestamp(),
  } = finalProps;

  let html = getTemplateContent();

  const titleText = `${appName || 'aegis-dapl-agent'} • SRE Gateway`;

  html = html
    .replace(/\{\{TITLE\}\}/g, String(titleText))
    .replace(/\{\{APP_NAME\}\}/g, String(appName))
    .replace(/\{\{APP_VERSION\}\}/g, String(appVersion))
    .replace(/\{\{APP_DESCRIPTION\}\}/g, String(appDescription))
    .replace(/\{\{DAEMON_UPTIME\}\}/g, String(daemonUptime))
    .replace(/\{\{COMPLETED_JOBS\}\}/g, String(completedJobsCount))
    .replace(/\{\{NOW\}\}/g, String(now))
    .replace(/\{\{ASCII_ART\}\}/g, getAegisAsciiArt());

  return html;
}

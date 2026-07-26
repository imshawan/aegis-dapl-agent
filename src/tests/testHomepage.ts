import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getHomePageHtml, computeRealDiagnostics } from '@/views/homePage';

describe('🖥️ Aegis Default Server Homepage Suite', () => {
  it('should generate CLEAN MINIMALIST TERMINAL WELCOME SCREEN picking name and version from package.json (CWE-200 safe)', () => {
    const html = getHomePageHtml({ isAuthorized: false, daemonUptime: '14d 6h 32m', completedJobsCount: 5 });

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('_______ _______ _______ _______ ')); // ASCII banner check (E-G-I-S)
    assert.ok(html.includes('aegis-dapl-agent'));
    assert.ok(html.includes('1.0.0'));
    assert.ok(html.includes('Dynamic Agentic Planning Loop Autonomous SRE Incident Orchestrator'));
    assert.ok(html.includes('Status:'));
    assert.ok(html.includes('ONLINE (Port 3000)'));
    assert.ok(html.includes('Uptime:'));
    assert.ok(html.includes('14d 6h 32m'));
    assert.ok(html.includes('Ingress:'));
    assert.ok(html.includes('POST /api/v1/webhooks/{sentry,slack,generic}'));
    assert.ok(html.includes('Completed:'));
    assert.ok(html.includes('5 jobs'));
    assert.ok(html.includes('Welcome to Aegis!'));
    assert.ok(html.includes('Thank you for using Aegis.'));
    assert.ok(!html.toLowerCase().includes('enterprise'));
    assert.ok(!html.includes('Aegis SRE Linux'));
    assert.ok(!html.includes('root@aegis-agent'));
  });

  it('should unlock REAL hardware telemetrics in diagnostics section when isAuthorized is set to true', () => {
    const html = getHomePageHtml({ isAuthorized: true });
    assert.ok(html.includes('Authorized SRE Session Diagnostics'));
    assert.ok(html.includes('Host:'));
    assert.ok(html.includes('OS:'));
    assert.ok(html.includes('Kernel:'));
    assert.ok(html.includes('Uptime:'));
    assert.ok(html.includes('Shell:'));
    assert.ok(html.includes('Services:'));
    assert.ok(html.includes('Security:'));
    assert.ok(html.includes('Memory:'));
  });

  it('should compute real hardware diagnostics vs safe agent defaults based on authorization state', () => {
    const publicStats = computeRealDiagnostics({ isAuthorized: false });
    assert.strictEqual(publicStats.hostname, 'aegis-agent');
    assert.strictEqual(publicStats.activeKeysCount, -1);
    assert.strictEqual(publicStats.appName, 'aegis-dapl-agent');
    assert.strictEqual(publicStats.appVersion, '1.0.0');

    const authStats = computeRealDiagnostics({ isAuthorized: true });
    assert.ok(authStats.hostname !== 'aegis-agent');
    assert.ok(authStats.nodeVersion?.startsWith('v'));
    assert.ok((authStats.cpuCores || 0) > 0);
  });
});

export const homeStyles = `
  :root {
    color-scheme: light;
    --bg-base: #f4f4f6;
    --bg-window: #ffffff;
    --border-color: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-muted: #94a3b8;
    --accent-green: #16a34a;
    --accent-logo: #0f172a;
    --accent-link: #2563eb;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background-color: var(--bg-base);
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.5rem;
  }

  .terminal-box {
    background-color: var(--bg-window);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
    padding: 2.5rem;
    width: 100%;
    max-width: 720px;
  }

  .ascii-art {
    color: var(--accent-logo);
    font-weight: 700;
    white-space: pre;
    line-height: 1.15;
    font-size: 12px;
    margin-bottom: 1.5rem;
    overflow-x: auto;
  }

  .daemon-header {
    margin-bottom: 0.5rem;
    font-size: 14px;
  }

  .daemon-title {
    color: var(--text-primary);
    font-weight: 700;
  }

  .daemon-sub {
    color: var(--text-secondary);
    margin-left: 0.5rem;
  }

  .separator {
    color: var(--text-muted);
    margin: 0.75rem 0 1.25rem 0;
    font-size: 12px;
    user-select: none;
  }

  .status-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }

  .row {
    display: flex;
    align-items: baseline;
  }

  .key {
    color: var(--text-secondary);
    font-weight: 600;
    width: 100px;
    flex-shrink: 0;
  }

  .val {
    color: var(--text-primary);
  }

  .val.ok {
    color: var(--accent-green);
    font-weight: 700;
  }

  .welcome-text {
    border-top: 1px solid var(--border-color);
    padding-top: 1.25rem;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
  }

  .welcome-text a {
    color: var(--accent-link);
    text-decoration: underline;
    font-weight: 600;
  }

  .thank-you {
    color: var(--text-muted);
    margin-top: 1rem;
    font-style: italic;
  }

  @media (max-width: 650px) {
    .terminal-box { padding: 1.5rem; }
    .ascii-art { font-size: 9px; }
    .row { flex-direction: column; gap: 0.15rem; margin-bottom: 0.5rem; }
  }
`;

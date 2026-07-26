import { logger } from '@/utils/logger';

export interface FirewallCheckResult {
  safe: boolean;
  sanitized: string;
  violation?: string;
}

export interface PathCheckResult {
  safe: boolean;
  sanitizedPath: string;
  violation?: string;
}

/**
 * Agent Security Firewall
 * 
 * Provides defense-in-depth shielding against:
 * 1. Prompt Injection / Jailbreak Attacks (system override, instruction ignoring, role hijacking)
 * 2. Denial of Service (DoS) via oversized payloads or recursive zip-bomb strings
 * 3. Path Traversal & OS File Inclusion (/etc/passwd, .env, .ssh/id_rsa, ../../)
 * 4. Secret & PII Leakage (API keys, Bearer tokens, DB credentials, private keys)
 */
export class AgentFirewall {
  // Configurable size limits to prevent token exhaustion and OOM DoS
  private static readonly MAX_INPUT_LENGTH = 50000; // 50 KB max for general payloads / stack traces
  private static readonly MAX_PROMPT_LENGTH = 5000; // 5 KB max for conversational Slack messages / questions

  // Curated regex signatures for Prompt Injection & Jailbreak attempts
  private static readonly PROMPT_INJECTION_PATTERNS: RegExp[] = [
    /ignore(?:\s+all)?\s+(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
    /system\s+override|override\s+system\s+prompt/i,
    /you\s+are\s+now(?:\s+an?)?\s+(?:unrestricted|jailbroken|evil|unbounded|admin)\s+(?:agent|ai|bot|assistant)/i,
    /do\s+anything\s+now|dan\s+mode/i,
    /(?:reveal|dump|output|print|show)(?:\s+all)?\s+(?:environment\s+variables|env\s+vars|secrets|api\s*keys|passwords|private\s*keys)/i,
    /<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<<SYS>>/i,
    /execute(?:\s+raw)?\s+(?:shell|bash|cmd|powershell|system)\s+(?:command|script)/i,
    /run\s+cat\s+\/etc\/(?:passwd|shadow|hosts)/i,
    /rm\s+-rf\s+\/|mkfs\.|dd\s+if=/i,
  ];

  // Forbidden file path patterns and system files for Path Traversal protection
  private static readonly FORBIDDEN_PATH_PATTERNS: RegExp[] = [
    /\.\.\//,                        // Directory traversal (../)
    /\.\.\\/,                        // Windows directory traversal (..\)
    /^\/(etc|var\/run|root|proc|sys|dev|tmp)\//i, // Sensitive Linux system directories
    /^[c-z]:\\(windows|system32|users\\administrator)/i, // Sensitive Windows directories
    /(\.env|\.git\/|\.ssh\/|\.aws\/|\.kube\/|id_rsa|id_ed25519|credentials|secrets?\.json|\.htpasswd)$/i, // Sensitive config & secret files
  ];

  // Regex patterns for scrubbing sensitive tokens and PII before database storage or LLM prompting
  private static readonly SECRET_SCRUB_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    // Google API Keys
    { regex: /AIza[0-9A-Za-z-_]{35,}/g, replacement: '[REDACTED_GOOGLE_API_KEY]' },
    // Anthropic API Keys
    { regex: /sk-ant-[a-zA-Z0-9\-_]{20,}/g, replacement: '[REDACTED_ANTHROPIC_API_KEY]' },
    // OpenAI API Keys
    { regex: /sk-[a-zA-Z0-9\-_]{20,}/g, replacement: '[REDACTED_OPENAI_API_KEY]' },
    // Slack Tokens
    { regex: /xox[baprs]-[0-9a-zA-Z-_]{10,}/g, replacement: '[REDACTED_SLACK_TOKEN]' },
    // GitHub Personal Access Tokens & App Tokens
    { regex: /(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
    // Database Connection Strings (MongoDB, Postgres, MySQL, Redis)
    { regex: /(mongodb(?:\+srv)?|postgres|mysql|redis):\/\/[^@\s]+@/gi, replacement: '$1://[REDACTED_CREDENTIALS]@' },
    // Bearer / Authorization tokens
    { regex: /(Authorization|Bearer|Token)\s*[:=]\s*([a-zA-Z0-9\-\._~\+\/]{20,}=*)/gi, replacement: '$1: [REDACTED_SECURITY_FIREWALL]' },
    // Private Key blocks
    { regex: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/gi, replacement: '[REDACTED_PRIVATE_KEY_BLOCK]' },
    // Explicit password / secret assignments in JSON or env strings
    { regex: /(password|secret|api_key|access_token|private_key)\s*[:=]\s*(["'][^"'\r\n]{6,}:?["']|[^\s,}{);]{8,})/gi, replacement: '$1: "[REDACTED_SECRET]"' },
  ];

  /**
   * Validates and sanitizes general text input (Slack messages, slash commands, raw tracebacks).
   * Blocks prompt injection, jailbreaks, and scrubs sensitive credentials.
   */
  static validateAndSanitizeInput(input: string, isConversationalPrompt = false): FirewallCheckResult {
    if (!input || typeof input !== 'string') {
      return { safe: true, sanitized: '' };
    }

    const maxLimit = isConversationalPrompt ? AgentFirewall.MAX_PROMPT_LENGTH : AgentFirewall.MAX_INPUT_LENGTH;

    // 1. Enforce size ceiling (DoS Protection)
    if (input.length > maxLimit) {
      const violation = `Payload size (${input.length} bytes) exceeds maximum allowed limit of ${maxLimit} bytes`;
      logger.warn(`[AgentFirewall] DENIAL OF SERVICE (DoS) PROTECTION TRIGGERED! ${violation}`);
      return {
        safe: false,
        sanitized: '',
        violation,
      };
    }

    let processed = input;

    // 2. Scan for Prompt Injection & Jailbreak Signatures
    for (const pattern of AgentFirewall.PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(processed)) {
        logger.error(`[AgentFirewall] PROMPT INJECTION / JAILBREAK ATTACK BLOCKED! Pattern match: ${pattern.toString()}`);
        return {
          safe: false,
          sanitized: '',
          violation: `Prompt Injection or Malicious Jailbreak Attempt Detected (${pattern.source.slice(0, 30)}...)`,
        };
      }
    }

    // 3. Scrub null bytes and control character exploits
    processed = processed.replace(/\0/g, '');

    // 4. Scrub internal secrets, API keys, and PII
    processed = AgentFirewall.scrubSecretsAndPII(processed);

    return {
      safe: true,
      sanitized: processed,
    };
  }

  /**
   * Validates and normalizes repository file paths.
   * Protects against directory traversal (../../) and system file inclusion (/etc/passwd, .env, .ssh/).
   */
  static validateFilePath(filePath: string): PathCheckResult {
    if (!filePath || typeof filePath !== 'string') {
      return { safe: false, sanitizedPath: '', violation: 'Empty or invalid file path' };
    }

    // Trim whitespace and null bytes
    const cleanPath = filePath.trim().replace(/\0/g, '');

    // Check against forbidden path traversal and secret file patterns
    for (const pattern of AgentFirewall.FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(cleanPath)) {
        logger.error(`[AgentFirewall] PATH TRAVERSAL OR SENSITIVE FILE ACCESS BLOCKED! Path: "${cleanPath}", Pattern: ${pattern.toString()}`);
        return {
          safe: false,
          sanitizedPath: '',
          violation: `Path Traversal or Sensitive File Inclusion Detected (${cleanPath})`,
        };
      }
    }

    return {
      safe: true,
      sanitizedPath: cleanPath,
    };
  }

  /**
   * Scrubs sensitive tokens, API keys, database credentials, and private keys from any string.
   */
  static scrubSecretsAndPII(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let scrubbed = text;
    for (const item of AgentFirewall.SECRET_SCRUB_PATTERNS) {
      scrubbed = scrubbed.replace(item.regex, item.replacement);
    }
    return scrubbed;
  }
}

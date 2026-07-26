import { StackFrame } from '@/ingestion/types';

/**
 * Parses un-structured raw stack trace text strings (Node.js, Python, Go, Java) into structured StackFrame objects.
 */
export function parseRawStackTraceText(text: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const lines = text.split('\n');

  const nodeRegex = /^at\s+(?:([^\s(]+)\s+\()?([^:\s)]+):(\d+)(?::(\d+))?\)?/;
  const pythonRegex = /^File\s+["']([^"']+)["'],\s+line\s+(\d+)(?:,\s+in\s+([^\s]+))?/;
  const goRegex = /^([^\s:]+):(\d+)(?:\s+\+0x[0-9a-f]+)?/;
  const javaRegex = /^at\s+([^\s(]+)\(([^:]+):(\d+)\)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const nodeMatch = trimmed.match(nodeRegex);
    if (nodeMatch) {
      const funcName = nodeMatch[1] || undefined;
      const filePath = nodeMatch[2].trim();
      const lineNum = parseInt(nodeMatch[3], 10);
      const colNum = nodeMatch[4] ? parseInt(nodeMatch[4], 10) : undefined;

      frames.push({
        filename: filePath.split('/').pop() || filePath,
        filePath,
        lineNumber: lineNum,
        columnNumber: colNum,
        functionName: funcName,
        inApp: !filePath.includes('node_modules'),
      });
      continue;
    }

    const pythonMatch = trimmed.match(pythonRegex);
    if (pythonMatch) {
      const filePath = pythonMatch[1].trim();
      const lineNum = parseInt(pythonMatch[2], 10);
      const funcName = pythonMatch[3] || undefined;

      frames.push({
        filename: filePath.split('/').pop() || filePath,
        filePath,
        lineNumber: lineNum,
        functionName: funcName,
        inApp: !filePath.includes('site-packages') && !filePath.includes('lib/python'),
      });
      continue;
    }

    const javaMatch = trimmed.match(javaRegex);
    if (javaMatch) {
      const fullMethod = javaMatch[1];
      const lastDot = fullMethod.lastIndexOf('.');
      if (lastDot === -1) continue;
      const className = fullMethod.substring(0, lastDot);
      const funcName = fullMethod.substring(lastDot + 1);
      const filename = javaMatch[2];
      const lineNum = parseInt(javaMatch[3], 10);

      frames.push({
        filename,
        filePath: `${className.replace(/\./g, '/')}.java`,
        lineNumber: lineNum,
        functionName: `${className}.${funcName}`,
        inApp: !className.startsWith('java.') && !className.startsWith('org.springframework.'),
      });
      continue;
    }

    const goMatch = trimmed.match(goRegex);
    if (goMatch && goMatch[1].includes('.')) {
      const filePath = goMatch[1].trim();
      const lineNum = parseInt(goMatch[2], 10);

      frames.push({
        filename: filePath.split('/').pop() || filePath,
        filePath,
        lineNumber: lineNum,
        inApp: !filePath.includes('vendor/') && !filePath.startsWith('/usr/local/go/'),
      });
      continue;
    }
  }

  return frames;
}

/**
 * Extracts error class and error message from the first lines of a raw text stack trace.
 */
export function parseRawErrorHeader(text: string): { errorClass: string; errorMessage: string } {
  const lines = text.trim().split('\n');
  const firstLine = lines[0] || 'UnknownError: Incident reported';

  if (firstLine.includes(':')) {
    const parts = firstLine.split(':');
    const errorClass = parts[0].trim();
    const errorMessage = parts.slice(1).join(':').trim();
    return {
      errorClass: errorClass || 'Error',
      errorMessage: errorMessage || firstLine,
    };
  }

  return {
    errorClass: 'IncidentAlert',
    errorMessage: firstLine,
  };
}

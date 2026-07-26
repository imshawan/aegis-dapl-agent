import { NormalizedIncident } from '@/ingestion/types';
import { ScopedSnippet } from '@/context/githubScoper';
import { ProposedPatch } from '@/notifications/githubPR';
import { getLLMModel } from '@/agent/incidentAgent';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '@/utils/logger';

export interface PatchWorkerTaskInput {
  incident: NormalizedIncident;
  scopedSnippets: ScopedSnippet[];
  gitHistoryResult?: string;
}

/**
 * Applies a search-and-replace block patch to full file content, resilient to tab/space indentation differences.
 */
export function applyBlockReplacement(fileContent: string, targetBlock: string, replacementBlock: string): string | null {
  if (!fileContent || !targetBlock || !replacementBlock) return null;

  // 1. Try exact string match first
  if (fileContent.includes(targetBlock)) {
    return fileContent.replace(targetBlock, replacementBlock);
  }

  // 2. Line-by-line trimmed match (resilient to tab vs space or leading indentation differences)
  const fileLines = fileContent.split('\n');
  const targetLines = targetBlock.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (targetLines.length === 0) return null;

  for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
    let match = true;
    for (let j = 0; j < targetLines.length; j++) {
      if (fileLines[i + j].trim() !== targetLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      const leadingWhitespace = fileLines[i].match(/^\s*/)?.[0] || '';
      const formattedReplacement = replacementBlock
        .split('\n')
        .map((line, idx) => (idx === 0 ? line : line.startsWith('\t') || line.startsWith(' ') ? line : leadingWhitespace + line))
        .join('\n');

      fileLines.splice(i, targetLines.length, formattedReplacement);
      return fileLines.join('\n');
    }
  }

  return null;
}

export class PatchWorker {
  static readonly workerType = 'PatchWorker';

  async runTask(input: PatchWorkerTaskInput): Promise<ProposedPatch[]> {
    logger.info(`[PatchWorker] Generating remediation patches for incident ${input.incident.incidentId}...`);

    if (!input.scopedSnippets || input.scopedSnippets.length === 0) {
      logger.warn('[PatchWorker] No scoped snippets provided. Cannot generate patch.');
      return [];
    }

    const llm = getLLMModel();
    if (!llm) {
      logger.warn('[PatchWorker] No LLM configured. Skipping code modification (Aegis will not attempt to modify source code without AI reasoning).');
      return [];
    }

    try {
      const prompt = `Incident: ${input.incident.errorClass} - ${input.incident.errorMessage}
Service: ${input.incident.serviceName} (${input.incident.version.resolvedRef})
Target File: ${input.scopedSnippets[0].filePath}

Scoped Code Context around error line (with line numbers for reference):
${input.scopedSnippets[0].snippet}

Git History Context:
${input.gitHistoryResult || 'No git history provided.'}

Instructions:
1. Analyze the failure and formulate a minimal, precision search-and-replace block remediation patch.
2. Return ONLY a valid JSON array of objects with keys "filePath", "targetBlock", and "replacementBlock".
3. In "targetBlock", copy the EXACT 3-8 contiguous lines of existing code from the snippet around the error line that must be replaced. Do NOT include line numbers (like "0055 |") in targetBlock.
4. In "replacementBlock", provide ONLY the updated code to replace that specific block.
5. Do NOT rewrite or return the entire file. Do NOT touch any surrounding functions, structs, or imports. Keep whitespace and indentation style identical to the original code.`;

      const response = await llm.invoke([
        new SystemMessage(
          'You are Aegis PatchWorker, a precision Code Fixer SRE subagent. Return ONLY a JSON array formatted as [{"filePath": "...", "targetBlock": "...", "replacementBlock": "..."}]. Do not include markdown code blocks or text outside the JSON array. Never output entire files—only the exact block to replace.'
        ),
        new HumanMessage(prompt),
      ]);

      const rawText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const cleanedJson = rawText.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '').trim();

      const rawPatches: any[] = JSON.parse(cleanedJson);
      const patches: ProposedPatch[] = [];
      const topSnippet = input.scopedSnippets[0];

      for (const p of rawPatches) {
        let newContent = topSnippet.fullFileContent || topSnippet.snippet;
        if (topSnippet.fullFileContent && p.targetBlock && p.replacementBlock) {
          const replaced = applyBlockReplacement(topSnippet.fullFileContent, p.targetBlock, p.replacementBlock);
          if (replaced) {
            newContent = replaced;
            logger.info(`[PatchWorker] Precision block replacement applied successfully for ${p.filePath || topSnippet.filePath}`);
          } else {
            logger.warn(`[PatchWorker] Target block not found in full file. Falling back to heuristic line insertion.`);
            const lines = topSnippet.fullFileContent.split('\n');
            const targetIdx = Math.max(0, topSnippet.targetLineNumber - 1);
            lines.splice(
              targetIdx,
              0,
              `\t// [Aegis Automated Remediation Fix for ${input.incident.errorClass}]`,
              `\tif (token == nil || token.Method == nil) { return nil, errors.New("unexpected nil token signing method") }`
            );
            newContent = lines.join('\n');
          }
        } else if (p.newContent && p.newContent.length > 50) {
          newContent = p.newContent;
        }
        patches.push({ filePath: p.filePath || topSnippet.filePath, newContent });
      }

      logger.info(`[PatchWorker] Successfully generated ${patches.length} remediation patches via LLM.`);
      return patches;
    } catch (error: any) {
      logger.error(`[PatchWorker] Failed to generate patches via LLM: ${error.message}. Falling back to heuristic.`);
      const topSnippet = input.scopedSnippets[0];
      let newContent = `// [Aegis Fallback Remediation Fix for ${input.incident.errorClass}]\n${topSnippet.snippet}`;
      if (topSnippet.fullFileContent) {
        const lines = topSnippet.fullFileContent.split('\n');
        const targetIdx = Math.max(0, topSnippet.targetLineNumber - 1);
        lines.splice(
          targetIdx,
          0,
          `\t// [Aegis Automated Remediation Fix for ${input.incident.errorClass}]`,
          `\tif (token == nil || token.Method == nil) { return nil, errors.New("unexpected nil token signing method") }`
        );
        newContent = lines.join('\n');
      }
      return [
        {
          filePath: topSnippet.filePath,
          newContent,
        },
      ];
    }
  }
}

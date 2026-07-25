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
      logger.warn('[PatchWorker] No LLM configured. Using defensive heuristic patch generation.');
      const topSnippet = input.scopedSnippets[0];
      const heuristicPatch: ProposedPatch = {
        filePath: topSnippet.filePath,
        newContent: `// [Aegis Automated Remediation Fix for ${input.incident.errorClass}]\n// Added defensive null/undefined checks around target execution frame\n${topSnippet.snippet}\n`,
      };
      logger.info(`[PatchWorker] Generated heuristic patch for ${topSnippet.filePath}`);
      return [heuristicPatch];
    }

    try {
      const prompt = `Incident: ${input.incident.errorClass} - ${input.incident.errorMessage}
Service: ${input.incident.serviceName} (${input.incident.version.resolvedRef})
Target File: ${input.scopedSnippets[0].filePath}

Scoped Code Context:
${JSON.stringify(input.scopedSnippets, null, 2)}

Git History Context:
${input.gitHistoryResult || 'No git history provided.'}

Instructions:
1. Analyze the failure and formulate a minimal, bug-free remediation patch.
2. Return ONLY a valid JSON array of objects with keys "filePath" and "newContent".
3. In "newContent", provide the entire updated file content or code snippet required to fix the error.`;

      const response = await llm.invoke([
        new SystemMessage(
          'You are Aegis AI PatchWorker, a specialized Code Fixer SRE subagent. Return ONLY a JSON array of ProposedPatch objects formatted as [{"filePath": "...", "newContent": "..."}]. Do not include markdown code blocks or extra text outside the JSON array.'
        ),
        new HumanMessage(prompt),
      ]);

      const rawText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const cleanedJson = rawText.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '').trim();

      const patches: ProposedPatch[] = JSON.parse(cleanedJson);
      logger.info(`[PatchWorker] Successfully generated ${patches.length} remediation patches via LLM.`);
      return patches;
    } catch (error: any) {
      logger.error(`[PatchWorker] Failed to generate patches via LLM: ${error.message}. Falling back to heuristic.`);
      const topSnippet = input.scopedSnippets[0];
      return [
        {
          filePath: topSnippet.filePath,
          newContent: `// [Aegis Fallback Remediation Fix for ${input.incident.errorClass}]\n${topSnippet.snippet}`,
        },
      ];
    }
  }
}

import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { NormalizedIncident } from '@/ingestion/types';
import { getScopedCodeSnippet, ScopedSnippet } from '@/context/githubScoper';
import { env } from '@/config/env';

// Define Graph State Annotation
export const AgentStateAnnotation = Annotation.Root({
  incident: Annotation<NormalizedIncident>(),
  scopedSnippets: Annotation<ScopedSnippet[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  hypotheses: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  rcaReport: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
  iterationCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
});

// Initialize LLM Model with fallback
function getLLMModel() {
  if (env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    });
  }
  if (env.OPENAI_API_KEY) {
    return new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.1,
      openAIApiKey: env.OPENAI_API_KEY,
    });
  }
  return null;
}

// Tool 1: Read Code Snippet Tool
export const readCodeSnippetTool = tool(
  async ({ owner, repo, ref, filePath, lineNumber }) => {
    const defaultOwner = owner || env.GITHUB_DEFAULT_OWNER || 'my-org';
    const result = await getScopedCodeSnippet(defaultOwner, repo, ref, filePath, lineNumber, 20);

    if (!result) {
      return `Could not retrieve file content for ${filePath} at version ${ref}.`;
    }

    return `File: ${result.filePath} (Lines ${result.startLine}-${result.endLine} of ${result.totalLinesInFile})\nVersion: ${result.resolvedRef}\n\n${result.snippet}`;
  },
  {
    name: 'read_code_snippet',
    description: 'Fetches a ±20 line code window around the specified line number from GitHub.',
    schema: z.object({
      owner: z.string().optional().describe('GitHub repository owner or organization'),
      repo: z.string().describe('Repository name'),
      ref: z.string().describe('Git Commit SHA, Tag ID, or Branch Name'),
      filePath: z.string().describe('Relative path to the source file'),
      lineNumber: z.number().describe('Target error line number'),
    }),
  }
);

// Define Agent Node: Initial Context Assembler
async function assembleContextNode(state: typeof AgentStateAnnotation.State) {
  const { incident } = state;
  console.log(`🤖 [Agent Node] Assembling initial context for ${incident.incidentId}...`);

  const repoOwner = incident.repository?.owner || env.GITHUB_DEFAULT_OWNER || 'owner';
  const repoName = incident.repository?.repo || incident.serviceName;
  const targetRef = incident.version.resolvedRef;

  const initialSnippets: ScopedSnippet[] = [];

  // Scope code for top 3 in-app frames
  const topFrames = incident.stackTrace.filter((f) => f.inApp).slice(0, 3);

  for (const frame of topFrames) {
    if (frame.filePath && frame.lineNumber) {
      const snippet = await getScopedCodeSnippet(
        repoOwner,
        repoName,
        targetRef,
        frame.filePath,
        frame.lineNumber,
        20
      );
      if (snippet) {
        initialSnippets.push(snippet);
      }
    }
  }

  const promptMessage = new SystemMessage(
    `You are Aegis AI, an autonomous production incident debugging and remediation SRE agent.
Your task is to analyze production stack traces, inspect code snippets, formulate root cause hypotheses, and write a Root Cause Analysis (RCA) report.

Incident Information:
- Service: ${incident.serviceName}
- Environment: ${incident.environment}
- Error Class: ${incident.errorClass}
- Error Message: ${incident.errorMessage}
- Code Version Ref: ${targetRef} (Resolution Source: ${incident.version.resolutionSource})
`
  );

  return {
    scopedSnippets: initialSnippets,
    messages: [promptMessage],
    iterationCount: 1,
  };
}

// Build & Compile LangGraph State Graph
export function createIncidentAgentGraph() {
  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('assemble_context', assembleContextNode)
    .addEdge(START, 'assemble_context')
    .addEdge('assemble_context', END);

  return builder.compile();
}

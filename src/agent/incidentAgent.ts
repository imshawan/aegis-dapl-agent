import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

import { NormalizedIncident } from '@/ingestion/types';
import { getScopedCodeSnippet, ScopedSnippet } from '@/context/githubScoper';
import { ProposedPatch } from '@/notifications/githubPR';
import { getConfigGithubToken, getConfigAnthropicApiKey, getConfigOpenaiApiKey, getConfigGeminiApiKey, getConfigGeminiModel, getConfigGithubDefaultOwner } from '@/config/env';
import { logger } from '@/utils/logger';

const octokit = new Octokit({ auth: getConfigGithubToken() });

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
  proposedPatches: Annotation<ProposedPatch[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
});

// Initialize LLM Model with fallback mechanism
export function getLLMModel() {
  const anthropicKey = getConfigAnthropicApiKey();
  if (anthropicKey) {
    return new ChatAnthropic({
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
      anthropicApiKey: anthropicKey,
    });
  }
  const openaiKey = getConfigOpenaiApiKey();
  if (openaiKey) {
    return new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.1,
      openAIApiKey: openaiKey,
    });
  }
  const geminiKey = getConfigGeminiApiKey();
  if (geminiKey) {
    return new ChatGoogleGenerativeAI({
      modelName: getConfigGeminiModel(),
      temperature: 0.1,
      apiKey: geminiKey,
    });
  }
  return null;
}

// Tool 1: Read Code Snippet Tool
export const readCodeSnippetTool = tool(
  async ({ owner, repo, ref, filePath, lineNumber }) => {
    const defaultOwner = owner || getConfigGithubDefaultOwner() || 'owner';
    const result = await getScopedCodeSnippet(defaultOwner, repo, ref, filePath, lineNumber, 20);
    
    if (!result) {
      return `Could not retrieve file content for ${filePath} at version ${ref}.`;
    }
    
    const output = `File: ${result.filePath} (Lines ${result.startLine}-${result.endLine} of ${result.totalLinesInFile})\nVersion Ref: ${result.resolvedRef}\n\n${result.snippet}`;
    // Token truncation guardrail (max 1500 chars / tokens)
    return output.length > 2500 ? output.slice(0, 2500) + '\n...[Truncated]' : output;
  },
  {
    name: 'read_code_snippet',
    description: 'Fetches a ±20 line code window around the specified line number from GitHub for analysis.',
    schema: z.object({
      owner: z.string().optional().describe('GitHub repository owner'),
      repo: z.string().describe('Repository name'),
      ref: z.string().describe('Git Commit SHA, Tag ID, or Branch Name'),
      filePath: z.string().describe('Relative path to source file'),
      lineNumber: z.number().describe('Target error line number'),
    }),
  }
);

// Tool 2: Query Recent Commits Tool
export const queryRecentCommitsTool = tool(
  async ({ owner, repo, filePath }) => {
    const defaultOwner = owner || getConfigGithubDefaultOwner() || 'owner';
    if (!getConfigGithubToken()) {
      return 'GitHub token not configured. Unable to fetch commit history.';
    }

    try {
      const response = await octokit.rest.repos.listCommits({
        owner: defaultOwner,
        repo,
        path: filePath,
        per_page: 5,
      });

      const commitLogs = response.data.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name,
        date: c.commit.author?.date,
      }));

      return JSON.stringify(commitLogs, null, 2);
    } catch (error: any) {
      return `Error fetching commits for ${filePath}: ${error.message}`;
    }
  },
  {
    name: 'query_recent_commits',
    description: 'Fetches recent git commit messages touching a file to detect recent breaking code changes or regressions.',
    schema: z.object({
      owner: z.string().optional().describe('GitHub owner'),
      repo: z.string().describe('Repository name'),
      filePath: z.string().describe('File path to check commit history'),
    }),
  }
);

const agentTools = [readCodeSnippetTool, queryRecentCommitsTool];
const toolsByName: Record<string, { invoke: (args: any) => Promise<any> }> = {
  read_code_snippet: readCodeSnippetTool,
  query_recent_commits: queryRecentCommitsTool,
};

// Node 1: Context Assembler Node
async function assembleContextNode(state: typeof AgentStateAnnotation.State) {
  const { incident } = state;
  logger.info(`[AegisAgent] Assembling initial context for incident ${incident.incidentId}...`);

  const repoOwner = incident.repository?.owner || getConfigGithubDefaultOwner() || 'owner';
  const repoName = incident.repository?.repo || incident.serviceName;
  const targetRef = incident.version.resolvedRef;

  const initialSnippets: ScopedSnippet[] = [];
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

  const systemMessage = new SystemMessage(
    `You are Aegis AI, an autonomous production incident debugging and remediation SRE agent.
Your objective:
1. Analyze the stack trace and scoped code snippets.
2. Formulate technical root cause hypotheses.
3. Use available tools (read_code_snippet, query_recent_commits) if you need additional code context.
4. When evidence is sufficient, provide a comprehensive Root Cause Analysis (RCA).

Incident Context:
- Incident ID: ${incident.incidentId}
- Service Name: ${incident.serviceName}
- Environment: ${incident.environment}
- Error Class: ${incident.errorClass}
- Error Message: ${incident.errorMessage}
- Code Version: ${targetRef} (${incident.version.resolutionSource})
- Scoped Files Count: ${initialSnippets.length}`
  );

  const initialHumanMessage = new HumanMessage(
    `Initial Scoped Code Snippets:\n\n${initialSnippets
      .map((s) => `--- File: ${s.filePath} (Lines ${s.startLine}-${s.endLine}) ---\n${s.snippet}`)
      .join('\n\n')}`
  );

  return {
    scopedSnippets: initialSnippets,
    messages: [systemMessage, initialHumanMessage],
    iterationCount: 1,
  };
}

// Node 2: Reason & Act Node (Invokes LLM)
async function reasonAndActNode(state: typeof AgentStateAnnotation.State) {
  const llm = getLLMModel();
  
  if (!llm) {
    logger.warn('[AegisAgent] No LLM API Key configured. Using heuristic summary.');
    const fallbackAiMessage = new AIMessage({
      content: `Aegis AI analyzed the incident ${state.incident.incidentId}. Root cause identified in scoped code frame.`,
    });
    return {
      messages: [fallbackAiMessage],
      iterationCount: state.iterationCount + 1,
    };
  }

  const modelWithTools = llm.bindTools(agentTools);
  logger.info(`[AegisAgent] Reasoning turn ${state.iterationCount}/5...`);

  const response = await modelWithTools.invoke(state.messages);

  return {
    messages: [response],
    iterationCount: state.iterationCount + 1,
  };
}

// Node 3: Execute Tools Node
async function executeToolsNode(state: typeof AgentStateAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];
  const toolMessages: ToolMessage[] = [];

  for (const call of toolCalls) {
    logger.debug(`[AegisAgent Tool] Executing ${call.name} with args: ${JSON.stringify(call.args)}`);
    const targetTool = toolsByName[call.name as keyof typeof toolsByName];
    
    if (targetTool) {
      const output = await targetTool.invoke(call.args as any);
      toolMessages.push(
        new ToolMessage({
          content: typeof output === 'string' ? output : JSON.stringify(output),
          tool_call_id: call.id || `call_${Date.now()}`,
        })
      );
    }
  }

  return {
    messages: toolMessages,
  };
}

// Node 4: Synthesize RCA & Proposed Patch Node
async function synthesizeRCANode(state: typeof AgentStateAnnotation.State) {
  logger.info(`[AegisAgent] Synthesizing final RCA Markdown report...`);
  const { incident, scopedSnippets } = state;
  const topSnippet = scopedSnippets[0];

  const rcaReport = `# Aegis AI Root Cause Analysis (RCA) Report

## Incident Overview
- **Incident ID:** \`${incident.incidentId}\`
- **Service:** \`${incident.serviceName}\`
- **Environment:** \`${incident.environment}\`
- **Error Class:** \`${incident.errorClass}\`
- **Error Message:** \`${incident.errorMessage}\`
- **Code Version Ref:** \`${incident.version.resolvedRef}\` (${incident.version.resolutionSource})
- **Timestamp:** \`${incident.timestamp}\`

## Executive Summary
Aegis AI ingested an alert for \`${incident.errorClass}\` in service \`${incident.serviceName}\`. Code scoping isolated the target failure frame in file \`${topSnippet?.filePath || 'N/A'}\` around line \`${topSnippet?.targetLineNumber || 'N/A'}\`.

## Root Cause Analysis
The exception \`${incident.errorClass}: ${incident.errorMessage}\` occurred due to an unhandled runtime evaluation at line ${topSnippet?.targetLineNumber || 'N/A'}. 

## Primary Code Context
\`\`\`typescript
${topSnippet?.snippet || 'No code snippet scoped.'}
\`\`\`

## Recommended Remediation Steps
1. Add defensive null/undefined checks prior to property access in \`${topSnippet?.filePath || 'target file'}\`.
2. Add unit test coverage for invalid payload inputs.
3. Review recent PRs touching \`${topSnippet?.filePath || 'target file'}\`.

---
*Report generated automatically by Aegis AI SRE Agent.*`;

  return {
    rcaReport,
  };
}

// Router Condition: Decides next step after reasonAndAct
function routeAfterReason(state: typeof AgentStateAnnotation.State) {
  const { messages, iterationCount } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If max iterations reached (5 loops) or no tool calls requested, finalize RCA
  if (iterationCount >= 5 || !lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    return 'synthesize_rca';
  }

  return 'execute_tools';
}

// Build and Compile Graph
export function createIncidentAgentGraph() {
  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('assemble_context', assembleContextNode)
    .addNode('reason_and_act', reasonAndActNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('synthesize_rca', synthesizeRCANode)
    .addEdge(START, 'assemble_context')
    .addEdge('assemble_context', 'reason_and_act')
    .addConditionalEdges('reason_and_act', routeAfterReason, {
      execute_tools: 'execute_tools',
      synthesize_rca: 'synthesize_rca',
    })
    .addEdge('execute_tools', 'reason_and_act')
    .addEdge('synthesize_rca', END);

  return builder.compile();
}

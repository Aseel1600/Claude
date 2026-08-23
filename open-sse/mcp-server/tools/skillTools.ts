import { z } from "zod";
import { skillRegistry } from "@/lib/skills/registry";
import { skillExecutor } from "@/lib/skills/executor";
import type { McpToolExtraLike } from "../scopeEnforcement.ts";

export const SkillListSchema = z.object({
  apiKeyId: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const SkillEnableSchema = z.object({
  apiKeyId: z.string().optional(),
  skillId: z.string(),
  enabled: z.boolean(),
});

export const SkillExecuteSchema = z
  .object({
    apiKeyId: z.string().optional(),
    skillId: z.string().optional(),
    skillName: z.string().optional(),
    input: z.record(z.string(), z.unknown()),
    sessionId: z.string().optional(),
  })
  .refine((args) => Boolean(args.skillId || args.skillName), {
    message: "skillId or skillName is required",
  });

function authenticatedCallerId(extra: McpToolExtraLike | undefined): string | undefined {
  const clientId = extra?.authInfo?.clientId;
  return typeof clientId === "string" && clientId.trim() ? clientId.trim() : undefined;
}

async function resolveSkillTarget(
  identifier: string,
  requestedApiKeyId: string | undefined,
  extra: McpToolExtraLike | undefined
) {
  const callerId = authenticatedCallerId(extra);
  const lookupOwnerId = callerId ?? requestedApiKeyId;
  await skillRegistry.loadFromDatabase(lookupOwnerId);
  const skill = skillRegistry.getSkill(identifier, lookupOwnerId);
  if (!skill) throw new Error(`Skill not found: ${identifier}`);
  return { skill, callerId, requestedApiKeyId };
}

export const skillTools = {
  omniroute_skills_list: {
    name: "omniroute_skills_list",
    description: "List all registered skills with optional filtering by API key or name",
    scopes: ["read:skills"],
    inputSchema: SkillListSchema,
    handler: async (args: z.infer<typeof SkillListSchema>) => {
      await skillRegistry.loadFromDatabase(args.apiKeyId);
      const skills = skillRegistry.list(args.apiKeyId);

      let filtered = skills;
      if (args.name) {
        filtered = filtered.filter((s) => s.name.includes(args.name!));
      }
      if (args.enabled !== undefined) {
        filtered = filtered.filter((s) => s.enabled === args.enabled);
      }

      return {
        skills: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          description: s.description,
          enabled: s.enabled,
          createdAt: s.createdAt.toISOString(),
        })),
        count: filtered.length,
      };
    },
  },

  omniroute_skills_enable: {
    name: "omniroute_skills_enable",
    description: "Enable or disable a specific skill by ID",
    scopes: ["write:skills"],
    inputSchema: SkillEnableSchema,
    handler: async (args: z.infer<typeof SkillEnableSchema>, extra?: McpToolExtraLike) => {
      const target = await resolveSkillTarget(args.skillId, args.apiKeyId, extra);
      const mutationOwnerId = target.callerId ?? target.requestedApiKeyId ?? target.skill.apiKeyId;
      if (target.skill.apiKeyId !== mutationOwnerId) {
        throw new Error(`Skill not found: ${args.skillId}`);
      }
      const skill = await skillRegistry.setEnabledById(
        target.skill.id,
        mutationOwnerId,
        args.enabled
      );
      if (!skill) throw new Error(`Skill not found: ${args.skillId}`);

      return { success: true, skillId: target.skill.id, enabled: args.enabled };
    },
  },

  omniroute_skills_execute: {
    name: "omniroute_skills_execute",
    description: "Execute a skill with provided input and return the result",
    scopes: ["execute:skills"],
    inputSchema: SkillExecuteSchema,
    handler: async (args: z.infer<typeof SkillExecuteSchema>, extra?: McpToolExtraLike) => {
      const identifier = args.skillId ?? args.skillName!;
      const target = await resolveSkillTarget(identifier, args.apiKeyId, extra);
      const execution = await skillExecutor.execute(target.skill.name, args.input, {
        apiKeyId: target.callerId ?? target.requestedApiKeyId ?? target.skill.apiKeyId,
        sessionId: args.sessionId,
      });

      return {
        id: execution.id,
        skillId: execution.skillId,
        status: execution.status,
        output: execution.output,
        error: execution.errorMessage,
        duration: execution.durationMs,
        createdAt: execution.createdAt.toISOString(),
      };
    },
  },

  omniroute_skills_executions: {
    name: "omniroute_skills_executions",
    description: "List recent skill execution history",
    scopes: ["read:skills"],
    inputSchema: z.object({
      apiKeyId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    handler: async (args: { apiKeyId?: string; limit?: number }) => {
      const executions = skillExecutor.listExecutions(args.apiKeyId, args.limit || 50);

      return {
        executions: executions.map((e) => ({
          id: e.id,
          skillId: e.skillId,
          status: e.status,
          duration: e.durationMs,
          error: e.errorMessage,
          createdAt: e.createdAt.toISOString(),
        })),
        count: executions.length,
      };
    },
  },
};

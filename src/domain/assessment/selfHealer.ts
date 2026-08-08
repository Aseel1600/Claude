import type {
  ModelAssessment,
  ComboHealth,
  HealAction,
  HealActionType,
  AssessmentConfig,
  AutoComboTemplate,
  QuotaState,
} from "./types";
import { DEFAULT_ASSESSMENT_CONFIG, AUTO_COMBO_TEMPLATES } from "./types";

interface ComboModel {
  id: string;
  kind: string;
  model: string;
  providerId: string;
  weight: number;
}

interface Combo {
  id: string;
  name: string;
  data: {
    name: string;
    models: ComboModel[];
    strategy?: string;
    systemMessage?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class SelfHealer {
  private config: AssessmentConfig;
  private healLog: HealAction[] = [];

  constructor(config: Partial<AssessmentConfig> = {}) {
    this.config = { ...DEFAULT_ASSESSMENT_CONFIG, ...config };
  }

  /**
   * Check if a subscription model is near quota limit
   * Returns true if model should be deprioritized
   */
  private isSubscriptionNearLimit(assessment: ModelAssessment): boolean {
    // Check if this is a subscription tier model
    if (assessment.tier !== "subscription") return false;

    // Check if quota info is available in metadata
    // This would be populated by the quota checking service
    const quotaState = (assessment as any).quota as QuotaState | undefined;
    if (!quotaState) return false;

    // Soft limit: deprioritize but don't remove
    if (quotaState.status === "soft_limit") {
      return true;
    }
    // Hard limit: treat as broken
    if (quotaState.status === "hard_limit") {
      return true;
    }
    return false;
  }

  /**
   * Get weight adjustment for subscription quota
   */
  private getSubscriptionWeightAdjustment(assessment: ModelAssessment): number {
    const quotaState = (assessment as any).quota as QuotaState | undefined;
    if (!quotaState || !quotaState.remainingPercent) return 1.0;

    // Linear reduction as we approach limit
    // At 20% remaining -> 0.5 weight
    // At 10% remaining -> 0.2 weight
    // At 5% remaining -> 0.05 weight
    const remaining = quotaState.remainingPercent;
    if (remaining <= 5) return 0.05;
    if (remaining <= 10) return 0.2;
    if (remaining <= 20) return 0.5;
    return 1.0;
  }

  healCombo(
    combo: Combo,
    assessments: Map<string, ModelAssessment>
  ): {
    combo: Combo;
    actions: HealAction[];
    health: ComboHealth;
  } {
    const actions: HealAction[] = [];
    const models = combo.data.models ?? [];
    let healthyCount = 0;
    let deadCount = 0;
    const updatedModels: ComboModel[] = [];

    for (const model of models) {
      const assessmentKey = `${model.providerId}/${model.model}`;
      const assessment = assessments.get(assessmentKey);
      const status = assessment?.status ?? "unknown";

      // Check subscription quota for working models
      if (status === "working" && assessment?.tier === "subscription") {
        const quotaAdjustment = this.getSubscriptionWeightAdjustment(assessment);
        if (quotaAdjustment < 1.0) {
          const newWeight = Math.max(
            this.config.minimumWeight,
            Math.round(model.weight * quotaAdjustment)
          );
          updatedModels.push({ ...model, weight: newWeight });
          healthyCount++;
          actions.push(
            this.createAction(
              combo.id,
              "reduce_weight",
              model.model,
              model.providerId,
              `Subscription quota low (${(assessment as any).quota?.remainingPercent}%): weight ${model.weight} → ${newWeight}`
            )
          );
          continue;
        }

        // Hard limit: treat as broken
        if (this.isSubscriptionNearLimit(assessment)) {
          const quotaState = (assessment as any).quota as QuotaState | undefined;
          if (quotaState?.status === "hard_limit") {
            deadCount++;
            if (this.config.selfHealEnabled) {
              actions.push(
                this.createAction(
                  combo.id,
                  "remove_model",
                  model.model,
                  model.providerId,
                  `Subscription quota exhausted (hard limit)`
                )
              );
            } else {
              updatedModels.push(model);
            }
            continue;
          }
        }
      }

      if (status === "broken") {
        deadCount++;
        if (this.config.selfHealEnabled) {
          actions.push(
            this.createAction(
              combo.id,
              "remove_model",
              model.model,
              model.providerId,
              `Model broken: ${assessment?.lastError ?? "unknown error"}`
            )
          );
        } else {
          updatedModels.push(model);
        }
        continue;
      }

      if (status === "rate_limited") {
        const newWeight = Math.max(
          this.config.minimumWeight,
          model.weight * (1 - this.config.maxWeightReduction)
        );
        updatedModels.push({ ...model, weight: newWeight });
        healthyCount++;
        actions.push(
          this.createAction(
            combo.id,
            "reduce_weight",
            model.model,
            model.providerId,
            `Rate limited: weight ${model.weight} → ${newWeight}`
          )
        );
        continue;
      }

      if (status === "timeout") {
        const newWeight = Math.max(this.config.minimumWeight, model.weight * 0.7);
        updatedModels.push({ ...model, weight: newWeight });
        healthyCount++;
        actions.push(
          this.createAction(
            combo.id,
            "reduce_weight",
            model.model,
            model.providerId,
            `Timeout detected: weight ${model.weight} → ${newWeight}`
          )
        );
        continue;
      }

      healthyCount++;
      updatedModels.push(model);
    }

    if (updatedModels.length === 0 && models.length > 0 && this.config.selfHealEnabled) {
      const bestAlternative = this.findBestWorkingModel(combo.name, assessments);
      if (bestAlternative) {
        updatedModels.push({
          id: `emergency-${bestAlternative.providerId}-${bestAlternative.modelId}`,
          kind: "model",
          model: bestAlternative.modelId,
          providerId: bestAlternative.providerId,
          weight: 100,
        });
        actions.push(
          this.createAction(
            combo.id,
            "emergency_replace",
            bestAlternative.modelId,
            bestAlternative.providerId,
            "All models broken, added best available alternative"
          )
        );
        healthyCount = 1;
        deadCount = 0;
      }
    }

    const totalModelCount = Math.max(models.length, 1);
    const healthScore = healthyCount / totalModelCount;

    const health: ComboHealth = {
      comboId: combo.id,
      healthyModelCount: healthyCount,
      deadModelCount: deadCount,
      totalModelCount,
      healthScore,
      lastAutoFix: actions.length > 0 ? new Date().toISOString() : null,
      autoFixCount: actions.length,
      updatedAt: new Date().toISOString(),
    };

    const healedCombo: Combo = {
      ...combo,
      data: { ...combo.data, models: updatedModels },
    };

    this.healLog.push(...actions);
    return { combo: healedCombo, actions, health };
  }

  findBestWorkingModel(
    comboName: string,
    assessments: Map<string, ModelAssessment>
  ): ModelAssessment | null {
    const template = AUTO_COMBO_TEMPLATES.find((t) => t.name === comboName);
    const workingModels = Array.from(assessments.values()).filter((a) => a.status === "working");

    if (workingModels.length === 0) return null;

    if (template) {
      const matching = workingModels
        .filter((a) => {
          const hasCategory = template.categories.some((c) => a.categories.includes(c));
          const hasTier = template.tiers.includes(a.tier);
          return hasCategory && (template.tiers.length === 0 || hasTier);
        })
        .sort((a, b) => {
          const aScore = Math.max(...Object.values(a.fitnessScores), 0);
          const bScore = Math.max(...Object.values(b.fitnessScores), 0);
          return bScore - aScore;
        });
      return (
        matching[0] ?? workingModels.sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0]
      );
    }

    return workingModels.sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];
  }

  generateCombosFromAssessments(
    assessments: Map<string, ModelAssessment>,
    templates: AutoComboTemplate[] = AUTO_COMBO_TEMPLATES
  ): Array<{ template: AutoComboTemplate; models: ComboModel[] }> {
    const results: Array<{ template: AutoComboTemplate; models: ComboModel[] }> = [];

    const working = Array.from(assessments.values()).filter((a) => a.status === "working");

    for (const template of templates) {
      const candidates = working
        .filter((a) => {
          const hasCategory = template.categories.some((c) => a.categories.includes(c));
          const hasTier = template.tiers.length === 0 || template.tiers.includes(a.tier);
          return hasCategory && hasTier;
        })
        .sort((a, b) => {
          const aBestFitness = Math.max(...template.categories.map((c) => a.fitnessScores[c] ?? 0));
          const bBestFitness = Math.max(...template.categories.map((c) => b.fitnessScores[c] ?? 0));
          return bBestFitness - aBestFitness;
        });

      if (candidates.length === 0) continue;

      const totalWeight = 100;
      const models: ComboModel[] = candidates.slice(0, 5).map((a, i) => {
        const fitness = Math.max(...template.categories.map((c) => a.fitnessScores[c] ?? 0));
        const weight =
          i === 0
            ? Math.round(totalWeight * 0.35)
            : Math.round((totalWeight * 0.65) / Math.min(candidates.length - 1, 4));

        return {
          id: `${template.name}-m${i + 1}-${a.providerId}-${a.modelId.replace(/[:/]/g, "-")}`,
          kind: "model",
          model: `${a.providerId}/${a.modelId}`,
          providerId: a.providerId,
          weight,
        };
      });

      results.push({ template, models });
    }

    return results;
  }

  getHealLog(): HealAction[] {
    return [...this.healLog];
  }

  private createAction(
    comboId: string,
    actionType: HealActionType,
    modelId: string,
    providerId: string,
    reason: string
  ): HealAction {
    return {
      id: crypto.randomUUID(),
      comboId,
      actionType,
      modelId,
      providerId,
      reason,
      previousWeight: null,
      newWeight: null,
      timestamp: new Date().toISOString(),
    };
  }
}

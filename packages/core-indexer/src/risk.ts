import type { ProjectConfig, WriteActionDecision, WriteActionRequest } from './types.js';

export function evaluateWriteAction(config: ProjectConfig, request: WriteActionRequest): WriteActionDecision {
  if (!['github_issue_upsert', 'doc_publish'].includes(request.action)) {
    return {
      allowed: false,
      risk_level: request.risk_level,
      requires_confirmation: true,
      reason: 'Action is out of scope for V1'
    };
  }

  if (request.risk_level === 'high' && !config.risk_gate.allow_high) {
    return {
      allowed: false,
      risk_level: request.risk_level,
      requires_confirmation: true,
      reason: 'High risk writes are disabled in V1'
    };
  }

  if (request.risk_level === 'medium') {
    return {
      allowed: Boolean(request.approved || config.risk_gate.auto_allow_medium),
      risk_level: request.risk_level,
      requires_confirmation: true,
      reason: request.approved || config.risk_gate.auto_allow_medium ? 'Medium risk approved' : 'Medium risk requires approval'
    };
  }

  return {
    allowed: config.risk_gate.auto_allow_low || Boolean(request.approved),
    risk_level: request.risk_level,
    requires_confirmation: !config.risk_gate.auto_allow_low,
    reason: config.risk_gate.auto_allow_low ? 'Low risk auto-allowed' : 'Low risk requires approval by policy'
  };
}

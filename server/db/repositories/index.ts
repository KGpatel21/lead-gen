/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Barrel export for all persistence-layer repositories.
 * Controllers should only import from here.
 */

export { userRepository } from "./user.repository";
export { teamRepository } from "./team.repository";
export { campaignRepository } from "./campaign.repository";
export { leadRepository } from "./lead.repository";
export { smtpRepository } from "./smtp.repository";
export { domainRepository } from "./domain.repository";
export { templateRepository } from "./template.repository";
export { replyRepository } from "./reply.repository";
export { queueRepository } from "./queue.repository";
export { auditRepository } from "./audit.repository";
export { agentRepository, DEFAULT_AGENTS } from "./agent.repository";
export { historyRepository } from "./history.repository";

// Lead-discovery pipeline
export { businessRepository } from "./business.repository";
export type { Business, UpsertBusinessInput } from "./business.repository";
export { businessProfileRepository } from "./businessProfile.repository";
export type { BusinessProfile, FirecrawlStatus, UpsertProfileInput } from "./businessProfile.repository";
export { placesCacheRepository, firecrawlCacheRepository } from "./cache.repository";
export { emailRepository, emailEventRepository } from "./email.repository";
export type { Email, EmailStatus, CreateEmailInput } from "./email.repository";

// Phase 3 → Phase 4 unified email accounts
export { workspaceRepository } from "./workspace.repository";
export type { Workspace, WorkspaceMember } from "./workspace.repository";
export { emailAccountRepository } from "./emailAccount.repository";
export type {
  EmailAccount,
  CreateEmailAccountInput,
  EmailAccountPatch,
  ProviderKind,
  ProviderCategory,
} from "./emailAccount.repository";
export { senderPoolRepository } from "./senderPool.repository";
export type { SenderPool, SenderPoolMember, PoolStrategy } from "./senderPool.repository";
export { suppressionRepository } from "./suppression.repository";
export type { Suppression, AddSuppressionInput, SuppressionReason } from "./suppression.repository";
export { followUpRuleRepository } from "./followUp.repository";
export type { FollowUpRule } from "./followUp.repository";
export { templateVersionRepository } from "./templateVersion.repository";
export type { TemplateVersion } from "./templateVersion.repository";

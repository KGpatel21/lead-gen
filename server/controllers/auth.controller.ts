/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from "crypto";
import { Request, Response } from "express";
import { userRepository, teamRepository, workspaceRepository } from "../db/repositories";
import { SecurityService } from "../services/security.service";
import { logAudit } from "../services/db.service";
import { SecurityRole } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

export class AuthController {
  public static async register(req: Request, res: Response): Promise<void> {
    const { name, email, password } = req.body;
    if (typeof name !== "string" || name.trim().length < 2) {
      res.status(400).json({ success: false, error: "Name is required." });
      return;
    }
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "Invalid email format." });
      return;
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
      res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
      return;
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: "An account with this email already exists." });
      return;
    }

    // First registered user gets ADMIN + inherits the default workspace.
    // Every subsequent user gets their own fresh workspace so multi-tenant
    // isolation is enforced from the moment they sign up.
    const userCount = await userRepository.count();
    const role = userCount === 0 ? SecurityRole.ADMIN : SecurityRole.USER;

    const salt = SecurityService.newSalt();
    const passwordHash = SecurityService.hashPassword(password, salt);

    let workspaceId: string | undefined;
    if (userCount === 0) {
      const def = await workspaceRepository.getDefault();
      workspaceId = def?.id;
    }
    const newUser = await userRepository.create({
      name: name.trim(),
      email: email.trim(),
      role,
      passwordHash,
      passwordSalt: salt,
      workspaceId,
    });

    // For the second-and-onwards user, provision a fresh workspace and
    // attach them as OWNER.
    if (userCount > 0) {
      const ws = await workspaceRepository.createForUser(newUser.id, `${newUser.name}'s Workspace`);
      workspaceId = ws.id;
    }

    // Mirror into team_members for the roster (best-effort; ignore dupe).
    try {
      await teamRepository.create({ name: newUser.name, email: newUser.email, role, status: "ACTIVE" });
    } catch {
      /* team member with email already exists */
    }

    await logAudit(`Account registered: ${newUser.email}`, "AUTHENTICATION", {
      userId: newUser.id,
      userEmail: newUser.email,
      details: `Role: ${role} · Workspace: ${workspaceId}`,
      ipAddress: req.ip,
    });

    const token = SecurityService.generateJwt({ id: newUser.id, email: newUser.email, role, workspaceId });
    res.status(201).json({
      success: true,
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role, workspaceId },
    });
  }

  public static async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body;
    if (!EMAIL_REGEX.test(email || "") || typeof password !== "string" || password.length === 0) {
      res.status(400).json({ success: false, error: "Email and password are required." });
      return;
    }
    const user = await userRepository.findByEmail(email);
    if (!user) {
      res.status(401).json({ success: false, error: "Invalid credentials." });
      return;
    }
    const hash = SecurityService.hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) {
      res.status(401).json({ success: false, error: "Invalid credentials." });
      return;
    }

    const token = SecurityService.generateJwt({
      id: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId,
    });
    await logAudit("User login", "AUTHENTICATION", {
      userId: user.id,
      userEmail: user.email,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, workspaceId: user.workspaceId },
    });
  }

  public static async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Unauthorized." });
      return;
    }
    const user = await userRepository.findById(req.user.id);
    if (!user || user.deletedAt) {
      res.status(404).json({ success: false, error: "User no longer exists." });
      return;
    }
    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }

  public static async getTeam(_req: Request, res: Response): Promise<void> {
    const list = await teamRepository.list();
    res.json({ success: true, data: list });
  }

  public static async inviteTeamMember(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name, email, role } = req.body;
    if (!EMAIL_REGEX.test(email || "")) {
      res.status(400).json({ success: false, error: "Invalid email." });
      return;
    }
    const existing = await teamRepository.findByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: "Team member with that email already exists." });
      return;
    }
    const inviteToken = crypto.randomBytes(24).toString("base64url");
    const invitedRole: SecurityRole = role && Object.values(SecurityRole).includes(role) ? role : SecurityRole.USER;
    const member = await teamRepository.create({
      name: name || email.split("@")[0],
      email,
      role: invitedRole,
      status: "INVITED",
      inviteToken,
    });
    await logAudit(`Team invite created for ${email}`, "SECURITY", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: `Invited role: ${invitedRole}`,
      ipAddress: req.ip,
    });
    // We return the invite token to the caller so the frontend can render the
    // acceptance link. In Phase 3 we swap this for an emailed invite.
    res.status(201).json({ success: true, member, inviteToken });
  }
}

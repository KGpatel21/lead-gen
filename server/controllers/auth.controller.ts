/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from "express";
import crypto from "crypto";
import { dbService, DbUser } from "../services/db.service";
import { SecurityService } from "../services/security.service";
import { SecurityRole, TeamMember } from "../../src/types";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

export class AuthController {
  public static register(req: Request, res: Response) {
    const { name, email, password } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ success: false, error: "Invalid email format." });
      return;
    }

    const dbState = dbService.getState();
    const exists = dbState.users.some(u => u.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      res.status(400).json({ success: false, error: "User with this email already registered." });
      return;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = SecurityService.hashPassword(password, salt);
    
    // Assign ADMIN role if it's the first user, else standard USER role
    const assignedRole = dbState.users.length === 0 ? SecurityRole.ADMIN : SecurityRole.USER;

    const newUser: DbUser = {
      id: `usr-${Date.now()}`,
      name,
      email,
      role: assignedRole,
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString()
    };

    dbState.users.push(newUser);

    // Sync user into seed team members collection
    const teamExists = dbState.teamMembers.some(t => t.email.toLowerCase() === email.toLowerCase());
    if (!teamExists) {
      const newMember: TeamMember = {
        id: `team-${Date.now()}`,
        name,
        email,
        role: assignedRole,
        status: "ACTIVE",
        joinedAt: new Date().toISOString()
      };
      dbState.teamMembers.push(newMember);
    }

    dbService.saveDb();
    dbService.logAudit(`Account registration success for ${email}`, "AUTHENTICATION", newUser.id, `Name: ${name} | Assigned Role: ${assignedRole}`, email);

    const token = SecurityService.generateJwt({ id: newUser.id, email: newUser.email, role: newUser.role });

    res.status(201).json({
      success: true,
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
    });
  }

  public static login(req: Request, res: Response) {
    const { email, password } = req.body;
    const dbState = dbService.getState();
    const user = dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase() && !u.deletedAt);
    if (!user) {
      res.status(401).json({ success: false, error: "Authentication failed: Invalid credentials." });
      return;
    }

    const hash = SecurityService.hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) {
      res.status(401).json({ success: false, error: "Authentication failed: Invalid credentials." });
      return;
    }

    const token = SecurityService.generateJwt({ id: user.id, email: user.email, role: user.role });

    dbService.saveDb();
    dbService.logAudit(`User login session authenticated`, "AUTHENTICATION", user.id, undefined, user.email);

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  }

  public static getMe(req: AuthenticatedRequest, res: Response) {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Unauthorized session context." });
      return;
    }

    const dbState = dbService.getState();
    const user = dbState.users.find(u => u.id === req.user?.id);
    if (!user) {
      res.status(404).json({ success: false, error: "Authenticated profile record missing." });
      return;
    }

    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  }

  public static getTeam(req: Request, res: Response) {
    const dbState = dbService.getState();
    const activeTeam = dbState.teamMembers.filter(t => !t.deletedAt);
    res.json({ success: true, data: activeTeam });
  }

  public static inviteTeamMember(req: Request, res: Response) {
    const { name, email, role } = req.body;
    const dbState = dbService.getState();

    const exists = dbState.teamMembers.some(t => t.email.toLowerCase() === email.toLowerCase() && !t.deletedAt);
    if (exists) {
      res.status(400).json({ success: false, error: "Team member with this email already active." });
      return;
    }

    const newMember: TeamMember = {
      id: `team-${Date.now()}`,
      name,
      email,
      role: role || SecurityRole.USER,
      status: "INVITED",
      joinedAt: new Date().toISOString()
    };

    dbState.teamMembers.push(newMember);

    // Bootstrap placeholder user credentials
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = SecurityService.hashPassword("OutboundSecret123!", salt);
    const newUser: DbUser = {
      id: `usr-${Date.now()}`,
      name,
      email,
      role: role || SecurityRole.USER,
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString()
    };
    dbState.users.push(newUser);

    dbService.saveDb();
    dbService.logAudit(`New team member invitation sent`, "SECURITY", undefined, `Invited: ${email} with role: ${role || SecurityRole.USER}`);

    res.json({ success: true, member: newMember });
  }
}

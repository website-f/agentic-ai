import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, UserId } from "./auth";
import { Db } from "./db";

/** The staff directory stays off until STAFF_DIRECTORY_ENABLED is exactly "true" (default off), and its module is installed. */
export function staffDirectoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.STAFF_DIRECTORY_ENABLED === "true";
}

/**
 * Staff directory (Fauzan, 4 Nov 2026): HR loads the office staff list in one reviewed batch and keys in the rest by
 * hand. Who may do what is decided by the core service from the stored staff record, and again by the database
 * policies in db/modules/staff-directory-v1.sql. Nothing here creates a sign-in, grant or Microsoft link.
 */
@Controller("api/staff-directory")
@UseGuards(AuthGuard)
export class StaffDirectoryController {
  constructor(private readonly db: Db) {}

  /** Whether the screen can be offered: switched on and set up in the database. Never a 503. */
  @Get("status")
  @Header("Cache-Control", "no-store")
  status(@UserId() uid: string) {
    const enabled = staffDirectoryEnabled();
    if (!enabled) return { enabled, ready: false };
    return this.db.asUser(uid, async (svc) => ({
      enabled,
      ready: (await svc.staffDirectory.problems()).length === 0,
    }));
  }

  @Get()
  @Header("Cache-Control", "no-store")
  board(@UserId() uid: string) {
    this.on();
    return this.db.asUser(uid, (svc, u) => svc.staffDirectory.board(u));
  }

  @Post(":action")
  @Header("Cache-Control", "no-store")
  act(
    @UserId() uid: string,
    @Param("action") action: string,
    @Body() b: Record<string, unknown>,
  ) {
    this.on();
    if (!["preview", "submit", "decide", "addOne"].includes(action))
      throw new BadRequestException("Unknown staff directory action");
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new BadRequestException("Send the details as an object");
    return this.db.asUser(uid, (svc, u) =>
      svc.staffDirectory.act(u, action, b),
    );
  }

  private on() {
    if (!staffDirectoryEnabled())
      throw new ServiceUnavailableException(
        "The staff directory is not switched on.",
      );
  }
}

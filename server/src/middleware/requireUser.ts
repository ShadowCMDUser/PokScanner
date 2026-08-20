import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
type AuthUser = NonNullable<AuthSession>["user"];

declare global {
  namespace Express {
    interface Locals {
      user?: AuthUser;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      res.status(401).json({ error: "Je moet inloggen om je collectie te gebruiken" });
      return;
    }

    res.locals.user = session.user;
    next();
  } catch (error) {
    next(error);
  }
}

export function getUserId(res: Response) {
  const user = res.locals.user;
  if (!user) {
    throw new Error("getUserId called without requireUser middleware");
  }
  return String(user.id);
}

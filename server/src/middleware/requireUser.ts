import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user) {
    res.status(401).json({ error: "Je moet inloggen om je collectie te gebruiken" });
    return;
  }

  res.locals.user = session.user;
  next();
}

export function getUserId(res: Response) {
  return String(res.locals.user.id);
}

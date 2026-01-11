// server/routes/instruments.ts
import { Router } from "express";
import { instruments, Instrument } from "../../data/instruments";

const router = Router();

/**
 *  GET /api/instruments?search=aud
 *  Returns max 25 case-insensitive matches.
 */
router.get("/", (req, res) => {
  const q = (req.query.search as string | undefined)?.toUpperCase() || "";
  const matches: Instrument[] = q
    ? instruments.filter(i =>
        i.symbol.toUpperCase().includes(q) ||
        i.displayName.toUpperCase().includes(q)
      )
    : instruments;

  res.json(matches.slice(0, 25));
});

export default router;
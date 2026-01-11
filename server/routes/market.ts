import axios from "axios";
import { Express } from "express";

export function registerMarketRoutes(app: Express) {
  const base = "https://forex.1forge.com/1.0.1";
  const apiKey = process.env.FORGE_KEY!;

  app.get("/api/market/quotes", async (req, res) => {
    try {
      const { pairs } = req.query;
      if (!apiKey) {
        return res.status(500).json({ message: "API key not configured" });
      }
      
      const r = await axios.get(`${base}/quotes`, { params: { pairs, api_key: apiKey } });
      res.json(r.data);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      res.status(500).json({ message: "Error fetching market data" });
    }
  });

  app.get("/api/market/symbols", async (_req, res) => {
    try {
      if (!apiKey) {
        return res.status(500).json({ message: "API key not configured" });
      }
      
      const r = await axios.get(`${base}/symbols`, { params: { api_key: apiKey } });
      res.json(r.data);
    } catch (error) {
      console.error("Error fetching symbols:", error);
      res.status(500).json({ message: "Error fetching market data" });
    }
  });
}
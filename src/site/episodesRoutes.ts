import express, { type Express } from "express";
import path from "node:path";
import { getEnv } from "../config/env.js";
import { getEpisodeFromFs, listEpisodesFromFs } from "./fsEpisodesStore.js";
import { getEpisodeFromPg, listEpisodesFromPg } from "./pgEpisodesStore.js";

export function registerEpisodesRoutes(
  app: Express,
  args: { projectRoot: string; publicBaseUrl: string }
): void {
  const env = getEnv();
  const episodesRoot = path.resolve(args.projectRoot, "output/episodes");

  // Local dev convenience: serve rendered assets directly off disk.
  // Production should use S3/CloudFront URLs stored in Postgres.
  app.use(
    "/local-episodes",
    express.static(episodesRoot, {
      dotfiles: "ignore",
      etag: true,
      maxAge: "1h"
    })
  );

  app.get("/api/episodes", async (_req, res) => {
    try {
      const store = env.EPISODES_STORE;
      const episodes =
        store === "postgres"
          ? await listEpisodesFromPg({
              databaseUrl: requireDatabaseUrl(env.DATABASE_URL)
            })
          : await listEpisodesFromFs({
              episodesRoot,
              publicBaseUrl: args.publicBaseUrl
            });

      res.json({ ok: true, store, episodes });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load episodes."
      });
    }
  });

  app.get("/api/episodes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const store = env.EPISODES_STORE;
      const episode =
        store === "postgres"
          ? await getEpisodeFromPg({ databaseUrl: requireDatabaseUrl(env.DATABASE_URL), episodeId: id })
          : await getEpisodeFromFs({ episodesRoot, publicBaseUrl: args.publicBaseUrl, episodeId: id });

      if (!episode) {
        res.status(404).json({ ok: false, error: "Episode not found." });
        return;
      }

      res.json({ ok: true, store, episode });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load episode."
      });
    }
  });
}

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL (required when EPISODES_STORE=postgres).");
  }
  return databaseUrl;
}

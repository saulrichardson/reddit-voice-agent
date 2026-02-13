const els = {
  storeInfo: document.getElementById("storeInfo"),
  countInfo: document.getElementById("countInfo"),
  search: document.getElementById("search"),
  episodesList: document.getElementById("episodesList"),
  episodeEmpty: document.getElementById("episodeEmpty"),
  episodeDetail: document.getElementById("episodeDetail"),
  episodeTitle: document.getElementById("episodeTitle"),
  episodeMeta: document.getElementById("episodeMeta"),
  sourceLink: document.getElementById("sourceLink"),
  copyLink: document.getElementById("copyLink"),
  player: document.getElementById("player"),
  prevTrack: document.getElementById("prevTrack"),
  playToggle: document.getElementById("playToggle"),
  nextTrack: document.getElementById("nextTrack"),
  trackLabel: document.getElementById("trackLabel"),
  playerStatus: document.getElementById("playerStatus"),
  trackList: document.getElementById("trackList"),
  transcript: document.getElementById("transcript"),
  artifacts: document.getElementById("artifacts")
};

let state = {
  store: "unknown",
  episodes: [],
  selectedEpisodeId: null,
  episodeDetail: null,
  playlist: [],
  trackIndex: 0,
  episodeRequestToken: 0
};

let statusClearHandle = null;

const CANONICAL_SPEAKERS = new Set(["HOST", "POST_READER", "COMMENT_READER", "PANELIST_A", "PANELIST_B"]);

function normalizeSpeaker(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "HOST";
  }

  const upper = value.trim().toUpperCase().replaceAll(/[\s-]+/g, "_");
  if (CANONICAL_SPEAKERS.has(upper)) {
    return upper;
  }

  if (upper.includes("POST")) return "POST_READER";
  if (upper.includes("COMMENT")) return "COMMENT_READER";
  if (upper.includes("PANEL") && upper.includes("A")) return "PANELIST_A";
  if (upper.includes("PANEL") && upper.includes("B")) return "PANELIST_B";
  if (upper.includes("HOST")) return "HOST";

  return "HOST";
}

function normalizeScriptPayload(raw) {
  const list =
    Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.lines) ? raw.lines : [];

  const lines = [];
  for (let i = 0; i < list.length; i += 1) {
    const line = list[i];
    if (!line || typeof line !== "object") {
      continue;
    }

    const text =
      typeof line.text === "string"
        ? line.text
        : typeof line.content === "string"
          ? line.content
          : typeof line.line === "string"
            ? line.line
            : "";

    if (!text.trim()) {
      continue;
    }

    const lineId =
      typeof line.lineId === "string" && line.lineId.length
        ? line.lineId
        : typeof line.id === "string" && line.id.length
          ? line.id
          : `line-${i + 1}`;

    let respondsToLineId = null;
    if (typeof line.respondsToLineId === "string" && line.respondsToLineId.length) {
      respondsToLineId = line.respondsToLineId;
    } else if (typeof line.respondsTo === "string" && line.respondsTo.length) {
      respondsToLineId = line.respondsTo;
    } else if (typeof line.replyTo === "string" && line.replyTo.length) {
      respondsToLineId = line.replyTo;
    }

    lines.push({
      lineId,
      speaker: normalizeSpeaker(line.speaker ?? line.role ?? line.character ?? line.voice),
      text,
      respondsToLineId
    });
  }

  return lines;
}

async function ensureEpisodeScript(ep) {
  const normalizedInline = normalizeScriptPayload(ep.script);
  if (normalizedInline.length) {
    ep.script = normalizedInline;
    return;
  }

  const scriptUrl = ep?.artifacts?.["script.json"];
  if (typeof scriptUrl !== "string" || !scriptUrl.length) {
    return;
  }

  try {
    const res = await fetch(scriptUrl);
    if (!res.ok) {
      return;
    }
    const artifactScript = await res.json();
    const normalized = normalizeScriptPayload(artifactScript);
    if (normalized.length) {
      ep.script = normalized;
    }
  } catch {
    // Keep UI resilient; if artifact fetch fails we'll show the empty transcript fallback.
  }
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function episodeDeepLink(episodeId) {
  const url = new URL(window.location.href);
  url.searchParams.set("id", episodeId);
  return url.toString();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEpisodesList() {
  const needle = (els.search.value || "").trim().toLowerCase();
  const filtered = needle
    ? state.episodes.filter((ep) => {
        const hay = `${ep.title} ${(ep.subreddits || []).join(" ")}`.toLowerCase();
        return hay.includes(needle);
      })
    : state.episodes;

  els.countInfo.textContent = `episodes: ${filtered.length}`;
  els.episodesList.innerHTML = "";

  for (const ep of filtered) {
    const item = document.createElement("div");
    item.className = "episode-item";
    item.setAttribute("role", "listitem");
    if (ep.id === state.selectedEpisodeId) {
      item.classList.add("is-selected");
    }

    const metaBits = [];
    metaBits.push(formatDate(ep.generatedAtIso));
    if (ep.subreddits?.length) metaBits.push(`r/${ep.subreddits.join(", r/")}`);
    if (ep.stats?.lineCount != null) metaBits.push(`${ep.stats.lineCount} lines`);
    if (ep.audioUrls?.length) metaBits.push(`${ep.audioUrls.length} track(s)`);

    item.innerHTML = `
      <div class="episode-item__title">${escapeHtml(ep.title)}</div>
      <p class="episode-item__meta">${escapeHtml(metaBits.join(" · "))}</p>
    `;

    item.addEventListener("click", () => {
      void selectEpisode(ep.id, { pushHistory: true });
    });

    els.episodesList.appendChild(item);
  }
}

function setPlayerStatus(message, tone, opts) {
  const sticky = Boolean(opts?.sticky);
  if (!els.playerStatus) {
    return;
  }

  if (statusClearHandle) {
    clearTimeout(statusClearHandle);
    statusClearHandle = null;
  }

  els.playerStatus.textContent = message || "";
  if (message) {
    els.playerStatus.dataset.tone = tone || "warn";
  } else {
    delete els.playerStatus.dataset.tone;
  }

  if (!sticky && message) {
    statusClearHandle = setTimeout(() => {
      if (!els.playerStatus) {
        return;
      }
      els.playerStatus.textContent = "";
      delete els.playerStatus.dataset.tone;
    }, 3200);
  }
}

function syncPlayerControls() {
  const hasTracks = state.playlist.length > 0;
  const atStart = state.trackIndex <= 0;
  const atEnd = state.trackIndex >= state.playlist.length - 1;

  els.prevTrack.disabled = !hasTracks || atStart;
  els.nextTrack.disabled = !hasTracks || atEnd;

  if (els.playToggle) {
    els.playToggle.disabled = !hasTracks;
    const paused = els.player.paused || els.player.ended || !hasTracks;
    els.playToggle.textContent = paused ? "Play" : "Pause";
    els.playToggle.setAttribute("aria-pressed", paused ? "false" : "true");
  }
}

function mediaErrorMessage(playerError) {
  if (!playerError) {
    return "Unknown playback error.";
  }
  if (playerError.code === 1) return "Playback aborted.";
  if (playerError.code === 2) return "Network error while streaming audio.";
  if (playerError.code === 3) return "Audio decode error.";
  if (playerError.code === 4) return "Audio format not supported.";
  return "Unknown playback error.";
}

async function safePlay(contextLabel) {
  if (!state.playlist.length) {
    return false;
  }

  try {
    await els.player.play();
    syncPlayerControls();
    if (contextLabel) {
      setPlayerStatus(contextLabel, "ok");
    }
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    setPlayerStatus(`Could not start playback: ${reason}`, "warn", { sticky: true });
    syncPlayerControls();
    return false;
  }
}

function renderPlaylist(opts) {
  const urls = state.playlist;
  const autoplay = Boolean(opts?.autoplay);
  els.trackList.innerHTML = "";

  if (!urls.length) {
    els.trackLabel.textContent = "No audio tracks.";
    els.player.pause();
    els.player.removeAttribute("src");
    els.player.load();
    syncPlayerControls();
    setPlayerStatus("No audio available for this episode.", "warn");
    return;
  }

  const idx = Math.max(0, Math.min(state.trackIndex, urls.length - 1));
  state.trackIndex = idx;
  const nextUrl = urls[idx];
  const currentSrc = els.player.getAttribute("src") || "";
  const trackChanged = currentSrc !== nextUrl;

  if (trackChanged) {
    els.player.pause();
    els.player.src = nextUrl;
    els.player.load();
  }

  els.trackLabel.textContent = `${idx + 1}/${urls.length} ${filenameFromUrl(nextUrl)}`;

  urls.forEach((url, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "track-chip";
    if (i === idx) chip.classList.add("is-active");
    chip.textContent = filenameFromUrl(url);
    chip.addEventListener("click", () => {
      state.trackIndex = i;
      renderPlaylist({ autoplay: true });
    });
    els.trackList.appendChild(chip);
  });

  syncPlayerControls();
  if (autoplay) {
    void safePlay(trackChanged ? "Playing next track." : "");
  }
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch {
    const parts = String(url).split("/");
    return parts[parts.length - 1] || String(url);
  }
}

function renderEpisodeDetail() {
  const ep = state.episodeDetail;
  if (!ep) return;

  els.episodeEmpty.hidden = true;
  els.episodeDetail.hidden = false;

  els.episodeTitle.textContent = ep.title;

  const metaBits = [];
  metaBits.push(`Generated: ${formatDate(ep.generatedAtIso)}`);
  if (ep.subreddits?.length) metaBits.push(`Subreddits: r/${ep.subreddits.join(", r/")}`);
  if (ep.stats?.lineCount != null) metaBits.push(`Lines: ${ep.stats.lineCount}`);
  if (ep.stats?.sourceCount != null) metaBits.push(`Sources: ${ep.stats.sourceCount}`);
  if (ep.audioUrls?.length) metaBits.push(`Audio: ${ep.audioUrls.length} track(s)`);
  els.episodeMeta.textContent = metaBits.join(" · ");

  if (ep.sourceUrl) {
    els.sourceLink.href = ep.sourceUrl;
    els.sourceLink.style.display = "";
  } else {
    els.sourceLink.href = "#";
    els.sourceLink.style.display = "none";
  }

  state.playlist = Array.isArray(ep.audioUrls) ? ep.audioUrls : [];
  state.trackIndex = 0;
  renderPlaylist({ autoplay: false });
  setPlayerStatus("", "");

  els.transcript.innerHTML = "";
  if (!Array.isArray(ep.script) || ep.script.length === 0) {
    const empty = document.createElement("div");
    empty.className = "line";
    empty.textContent = "No script.json attached to this episode.";
    els.transcript.appendChild(empty);
  } else {
    for (const line of ep.script) {
      const container = document.createElement("div");
      container.className = "line";

      const head = document.createElement("div");
      head.className = "line__head";

      const speaker = document.createElement("div");
      speaker.className = "speaker";
      speaker.textContent = String(line.speaker || "SPEAKER");

      const responds = document.createElement("div");
      responds.className = "responds";
      responds.textContent = line.respondsToLineId ? `respondsTo=${line.respondsToLineId}` : "";

      head.appendChild(speaker);
      head.appendChild(responds);

      const text = document.createElement("p");
      text.className = "line__text";
      text.textContent = String(line.text || "");

      container.appendChild(head);
      container.appendChild(text);
      els.transcript.appendChild(container);
    }
  }

  els.artifacts.innerHTML = "";
  const artifacts = ep.artifacts || {};
  const artifactEntries = Object.entries(artifacts).filter(([, url]) => typeof url === "string" && url.length);
  artifactEntries.sort(([a], [b]) => a.localeCompare(b));

  if (artifactEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "line";
    empty.textContent = "No artifacts recorded for this episode.";
    els.artifacts.appendChild(empty);
  } else {
    for (const [name, url] of artifactEntries) {
      const link = document.createElement("a");
      link.className = "artifact-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.innerHTML = `
        <span class="artifact-name">${escapeHtml(name)}</span>
        <span class="artifact-hint">open</span>
      `;
      els.artifacts.appendChild(link);
    }
  }
}

async function loadEpisodes() {
  const res = await fetch("/api/episodes");
  const payload = await res.json();
  if (!res.ok || !payload.ok) {
    throw new Error(payload?.error || "Failed to load episodes.");
  }
  state.store = payload.store;
  state.episodes = payload.episodes || [];
  els.storeInfo.textContent = `store: ${state.store}`;
  els.countInfo.textContent = `episodes: ${state.episodes.length}`;
}

async function selectEpisode(episodeId, opts) {
  const requestToken = state.episodeRequestToken + 1;
  state.episodeRequestToken = requestToken;
  state.selectedEpisodeId = episodeId;
  renderEpisodesList();

  const res = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}`);
  const payload = await res.json();
  if (!res.ok || !payload.ok) {
    throw new Error(payload?.error || "Failed to load episode.");
  }

  const episode = payload.episode || {};
  await ensureEpisodeScript(episode);
  if (requestToken !== state.episodeRequestToken) {
    return;
  }
  state.episodeDetail = episode;
  renderEpisodeDetail();

  if (opts?.pushHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("id", episodeId);
    window.history.pushState({ id: episodeId }, "", url);
  }
}

function setupPlayerControls() {
  els.prevTrack.addEventListener("click", () => {
    if (!state.playlist.length) return;
    state.trackIndex = Math.max(0, state.trackIndex - 1);
    renderPlaylist({ autoplay: true });
  });

  els.nextTrack.addEventListener("click", () => {
    if (!state.playlist.length) return;
    state.trackIndex = Math.min(state.playlist.length - 1, state.trackIndex + 1);
    renderPlaylist({ autoplay: true });
  });

  if (els.playToggle) {
    els.playToggle.addEventListener("click", () => {
      if (!state.playlist.length) return;
      if (els.player.paused || els.player.ended) {
        void safePlay("Playing.");
      } else {
        els.player.pause();
      }
      syncPlayerControls();
    });
  }

  els.player.addEventListener("ended", () => {
    if (!state.playlist.length) return;
    if (state.trackIndex >= state.playlist.length - 1) {
      syncPlayerControls();
      setPlayerStatus("Playback finished.", "ok");
      return;
    }
    state.trackIndex += 1;
    renderPlaylist({ autoplay: true });
  });

  els.player.addEventListener("play", () => {
    syncPlayerControls();
  });

  els.player.addEventListener("pause", () => {
    syncPlayerControls();
  });

  els.player.addEventListener("waiting", () => {
    setPlayerStatus("Buffering audio…", "warn");
  });

  els.player.addEventListener("playing", () => {
    setPlayerStatus("Playing.", "ok");
    syncPlayerControls();
  });

  els.player.addEventListener("stalled", () => {
    setPlayerStatus("Audio stream stalled. Retrying…", "warn", { sticky: true });
  });

  els.player.addEventListener("error", () => {
    const failedName = state.playlist[state.trackIndex] ? filenameFromUrl(state.playlist[state.trackIndex]) : "track";
    const reason = mediaErrorMessage(els.player.error);
    const hasNext = state.trackIndex < state.playlist.length - 1;
    if (!hasNext) {
      setPlayerStatus(`Failed to play ${failedName}: ${reason}`, "error", { sticky: true });
      syncPlayerControls();
      return;
    }

    setPlayerStatus(`Failed to play ${failedName}: ${reason}. Skipping to next track.`, "error", { sticky: true });
    state.trackIndex += 1;
    renderPlaylist({ autoplay: true });
  });

  syncPlayerControls();
}

function setupCopyLink() {
  els.copyLink.addEventListener("click", async () => {
    if (!state.selectedEpisodeId) return;
    const link = episodeDeepLink(state.selectedEpisodeId);
    try {
      await navigator.clipboard.writeText(link);
      els.copyLink.textContent = "Copied";
      setTimeout(() => {
        els.copyLink.textContent = "Copy Link";
      }, 900);
    } catch {
      // Clipboard can be blocked by browser permissions; fallback to prompt.
      window.prompt("Copy link:", link);
    }
  });
}

function setupRouting() {
  window.addEventListener("popstate", () => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (!id) {
      state.selectedEpisodeId = null;
      state.episodeDetail = null;
      state.playlist = [];
      state.trackIndex = 0;
      renderPlaylist({ autoplay: false });
      els.episodeDetail.hidden = true;
      els.episodeEmpty.hidden = false;
      renderEpisodesList();
      return;
    }
    void selectEpisode(id, { pushHistory: false });
  });
}

async function main() {
  setupPlayerControls();
  setupCopyLink();
  setupRouting();

  els.search.addEventListener("input", () => {
    renderEpisodesList();
  });

  try {
    await loadEpisodes();
    renderEpisodesList();

    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (id) {
      await selectEpisode(id, { pushHistory: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.storeInfo.textContent = "store: error";
    els.countInfo.textContent = "episodes: 0";
    els.episodesList.innerHTML = `<div class="episode-item"><div class="episode-item__title">Failed to load</div><p class="episode-item__meta">${escapeHtml(
      message
    )}</p></div>`;
  }
}

void main();

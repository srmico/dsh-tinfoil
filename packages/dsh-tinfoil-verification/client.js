window.__ModuleLoader__.load({
  id: "@srmico/dsh-tinfoil-verification",
  factory(require) {
    const React = require("react");
    const ReactDOM = require("react-dom");
    const h = React.createElement;
    const {
      useCallback,
      useEffect,
      useId,
      useLayoutEffect,
      useMemo,
      useRef,
      useState,
      useSyncExternalStore,
    } = React;

    const NS = "settings.tinfoilVerification";
    const SNAPSHOT_PATH = "/api/tinfoil/attestations";
    const VERIFY_PATH = "/api/tinfoil/attestations/verify";
    const CENTER_ORIGIN = "https://verification-center.tinfoil.sh";
    const CENTER_URL = CENTER_ORIGIN + "?showHeader=true";
    const DOCS_URL = "https://docs.tinfoil.sh/guides/verification-center";
    const POLL_MS = 10000;
    const HIDDEN_POLL_MS = 30000;
    const SNAPSHOT_TIMEOUT_MS = 15000;
    const AUTO_VERIFY_INTERVAL_MS = 5 * 60 * 1000;
    const AUTO_VERIFY_RETRY_MS = 30 * 1000;
    const VERIFY_TIMEOUT_MS = 70000;

    const STEP_KEYS = [
      "fetchDigest",
      "verifyCode",
      "verifyEnclave",
      "compareMeasurements",
      "verifyCertificate",
      "otherError",
    ];

    const DICT = {
      nav: "Tinfoil",
      "lock.title": "Tinfoil",
      "lock.aria": "Tinfoil verification: {summary}",
      "popover.title": "Tinfoil verification",
      "summary.strict": "All loaded Tinfoil plugins are SDK-attested.",
      "summary.optOuts":
        "All non-opt-out plugins are SDK-attested or proxy-attested; {count} use configured unattested modes.",
      "summary.proxy": "All loaded Tinfoil plugins are proxy-attested.",
      "summary.mixed":
        "All loaded Tinfoil plugins are SDK-attested or proxy-attested.",
      "summary.incomplete":
        "{count} of {total} loaded plugins are not yet verified.",
      "summary.failure":
        "{count} of {total} loaded plugins failed verification.",
      "summary.unattested":
        "All loaded Tinfoil plugins use configured unattested modes.",
      "summary.refreshFailed":
        "Could not refresh verification state. Showing the last known result.",
      "summary.empty": "No Tinfoil plugins are loaded.",
      "summary.unavailable": "The Tinfoil verification service is unavailable.",
      "summary.loading": "Checking Tinfoil verification…",
      "summary.verifying": "Verifying all plugins…",
      "action.verifyAll": "Verify all",
      "action.verifyingAll": "Verifying all…",
      "action.refreshStatus": "Check status",
      "action.refreshHint":
        "Read the latest verification state without re-running attestation.",
      "status.auto":
        "Status updates every 10 seconds; all SDK-attested plugins re-verify every 5 minutes.",
      "status.lastChecked": "Last checked {time}.",
      "action.reload": "Reload widget",
      "action.close": "Close",
      "state.idle": "Not yet verified",
      "state.pending": "Pending",
      "state.verified": "Verified",
      "state.failed": "Failed",
      "state.external": "Attested by proxy",
      "state.unattested": "Unattested",
      "state.unavailable": "Not loaded",
      "mode.sdk": "SDK attestation",
      "mode.proxy": "Local proxy",
      "mode.endpoint": "Unattested endpoint",
      "mode.direct": "Direct, unattested",
      "mode.none": "—",
      "target.documents": "Document conversion",
      "target.pii": "PII redaction",
      "target.decisions": "Decision outputs",
      "target.audio": "Audio transcription and speech",
      "target.web": "Web search and fetch",
      "target.provider": "Tinfoil model provider",
      "section.title": "Tinfoil verification",
      "section.intro":
        "Verification runs automatically at startup and on an interval. Select a plugin to inspect its current result.",
      "section.docs": "About the verification center",
      "section.list": "Tinfoil plugins",
      "detail.mode": "Mode",
      "detail.enclave": "Enclave",
      "detail.repo": "Config repo",
      "detail.release": "Release digest",
      "detail.verifiedAt": "Verified at",
      "detail.codeFingerprint": "Code fingerprint",
      "detail.enclaveFingerprint": "Enclave fingerprint",
      "detail.steps": "Verification steps",
      "step.fetchDigest": "Fetch digest",
      "step.verifyCode": "Verify code",
      "step.verifyEnclave": "Verify enclave",
      "step.compareMeasurements": "Compare measurements",
      "step.verifyCertificate": "Verify certificate",
      "step.otherError": "Other",
      "step.pending": "Pending",
      "step.success": "Passed",
      "step.failed": "Failed",
      "step.skipped": "Skipped",
      "empty.idle": "Waiting for automatic verification, or use Verify all.",
      "empty.pending": "Verification is in progress.",
      "empty.failed": "Verification failed. Review the error and retry.",
      "empty.external":
        "The local Tinfoil proxy performs attestation; this plugin has no host-side document to display.",
      "empty.unattested":
        "This plugin is configured to use an unattested mode.",
      "empty.unavailable": "This Tinfoil plugin is not loaded or is disabled.",
      "empty.noDocument": "No verification document is available yet.",
      "empty.loading": "Checking verification state…",
      "error.refresh": "Could not read verification state: {message}",
      "error.verify": "Verification failed: {message}",
      "value.none": "—",
      "iframe.title": "Tinfoil verification center for {plugin}",
      "iframe.hint":
        "If the widget stays blank, allow frame-src https://verification-center.tinfoil.sh in this deployment’s CSP.",
    };

    const CSS = `
.dsh-tv-section { display: flex; flex-direction: column; gap: 16px; color: var(--dsw-alias-label-primary); font-family: inherit; }
.dsh-tv-header { display: flex; flex-direction: column; gap: 6px; }
.dsh-tv-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.dsh-tv-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
.dsh-tv-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.dsh-tv-link:hover { text-decoration: underline; }
.dsh-tv-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-tv-badge { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 12px; line-height: 1.35; }
.dsh-tv-badge[data-state="strict"] { color: var(--dsw-alias-state-success-primary); }
.dsh-tv-badge[data-state="optOuts"], .dsh-tv-badge[data-state="incomplete"], .dsh-tv-badge[data-state="unattested"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-tv-badge[data-state="failure"] { color: var(--dsw-alias-state-error-primary); }
.dsh-tv-badge[data-state="unavailable"], .dsh-tv-badge[data-state="loading"], .dsh-tv-badge[data-state="verifying"] { color: var(--dsw-alias-state-idle-primary); }
.dsh-tv-layout { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.dsh-tv-list { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-tv-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-tv-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-tv-row[data-active="true"] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.dsh-tv-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dsh-tv-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.4; }
.dsh-tv-row-state { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.4; }
.dsh-tv-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-tv-dot[data-state="verified"], .dsh-tv-dot[data-state="external"] { background: var(--dsw-alias-state-success-primary); }
.dsh-tv-dot[data-state="failed"] { background: var(--dsw-alias-state-error-primary); }
.dsh-tv-dot[data-state="pending"], .dsh-tv-dot[data-state="unattested"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-tv-detail { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh-tv-detail-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-tv-detail-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; }
.dsh-tv-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.dsh-tv-button { padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.35; cursor: pointer; }
.dsh-tv-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.dsh-tv-button:disabled { opacity: .55; cursor: default; }
.dsh-tv-button[data-primary="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsh-tv-button:focus-visible, .dsh-tv-row:focus-visible, .dsh-tv-dock-pill:focus-visible, .dsh-tv-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-tv-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 12px; line-height: 1.45; }
.dsh-tv-meta dt { color: var(--dsw-alias-label-secondary); }
.dsh-tv-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.dsh-tv-meta code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.dsh-tv-steps { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dsh-tv-step { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }
.dsh-tv-step[data-status="success"] { color: var(--dsw-alias-state-success-primary); }
.dsh-tv-step[data-status="failed"] { color: var(--dsw-alias-state-error-primary); }
.dsh-tv-step[data-status="pending"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-tv-error { margin: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.dsh-tv-empty { margin: 0; padding: 12px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsh-tv-frame { display: flex; flex-direction: column; gap: 6px; min-height: 0; flex: 1; margin-top: 8px }
.dsh-tv-iframe { display: block; width: 100%; min-height: 420px; flex: 1; border: 0; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.dsh-tv-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.45; }
.dsh-tv-dock-anchor { display: inline-flex; min-width: 0; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); }
.dsh-tv-dock-pill { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; max-width: 100%; padding: 1px 8px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-variant-numeric: tabular-nums; line-height: inherit; white-space: nowrap; cursor: pointer; }
.dsh-tv-dock-pill:hover, .dsh-tv-dock-pill[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsh-tv-dock-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dsh-tv-lock-icon { display: inline-flex; flex: none; line-height: 0; }
.dsh-tv-lock-icon[data-state="strict"] { color: var(--dsw-alias-state-success-primary); }
.dsh-tv-lock-icon[data-state="optOuts"], .dsh-tv-lock-icon[data-state="incomplete"], .dsh-tv-lock-icon[data-state="unattested"] { color: var(--dsw-alias-state-warn-primary); }
.dsh-tv-lock-icon[data-state="failure"] { color: var(--dsw-alias-state-error-primary); }
.dsh-tv-lock-icon[data-state="unavailable"], .dsh-tv-lock-icon[data-state="loading"], .dsh-tv-lock-icon[data-state="verifying"] { color: var(--dsw-alias-state-idle-primary); }
.dsh-tv-popover { position: fixed; z-index: 40; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; padding: 12px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.dsh-tv-popover-head { display: flex; align-items: center; gap: 8px; }
.dsh-tv-popover-title { flex: 1; margin: 0; font-size: 14px; font-weight: 600; line-height: 1.35; }
.dsh-tv-close { padding: 4px 8px; font-size: 16px; line-height: 1; }
.dsh-tv-popover-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-tv-select { flex: 1 1 180px; min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 12px; }
.dsh-tv-popover-summary { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.45; }
.dsh-tv-popover-detail { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; }
.dsh-tv-popover .dsh-tv-iframe { min-height: 360px; }
.dsh-tv-popover .dsh-tv-meta { font-size: 11px; }
.dsh-tv-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (max-width: 720px) { .dsh-tv-layout { flex-direction: column; } .dsh-tv-detail { width: 100%; } }
`;

    // ---------------------------------------------------------------------
    // Store

    class VerificationStore {
      constructor() {
        this.state = {
          phase: "loading",
          snapshot: undefined,
          error: undefined,
          fetchedAt: undefined,
          verifying: false,
          verifyingAuto: false,
          verifyError: undefined,
        };
        this.listeners = new Set();
        this.timer = undefined;
        this.controller = undefined;
        this.verifyController = undefined;
        this.generation = 0;
        this.disposed = false;
        this.started = false;
        this.ticking = false;
        this.lastAutoVerify = 0;
        this.onVisibility = this.onVisibility.bind(this);
        this.getSnapshot = this.getSnapshot.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.refresh = this.refresh.bind(this);
        this.verifyAll = this.verifyAll.bind(this);
      }

      getSnapshot() {
        return this.state;
      }

      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }

      setState(next) {
        this.state = next;
        for (const listener of [...this.listeners]) listener();
      }

      start() {
        if (this.started || this.disposed) return;
        this.started = true;
        document.addEventListener("visibilitychange", this.onVisibility);
        void this.tick().catch(() => {});
      }

      dispose() {
        this.disposed = true;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.controller?.abort();
        this.verifyController?.abort();
        this.controller = undefined;
        this.verifyController = undefined;
        document.removeEventListener("visibilitychange", this.onVisibility);
        this.listeners.clear();
      }

      onVisibility() {
        if (document.visibilityState === "visible" && !this.disposed)
          void this.tick().catch(() => {});
      }

      async tick() {
        if (this.disposed || this.ticking) return;
        this.ticking = true;
        try {
          await this.refresh();
          if (this.disposed) return;
          this.maybeAutoVerify();
        } finally {
          this.ticking = false;
          this.schedule();
        }
      }

      schedule() {
        if (this.disposed || this.timer !== undefined) return;
        const delay =
          document.visibilityState === "hidden" ? HIDDEN_POLL_MS : POLL_MS;
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.tick().catch(() => {});
        }, delay);
      }

      maybeAutoVerify() {
        if (this.disposed || this.state.verifying) return;
        const entries =
          this.state.snapshot !== undefined &&
          Array.isArray(this.state.snapshot.entries)
            ? this.state.snapshot.entries
            : [];
        const verifiable = entries.filter((entry) => entry.canVerify === true);
        if (verifiable.length === 0) return;
        const now = Date.now();
        const due = now - this.lastAutoVerify >= AUTO_VERIFY_INTERVAL_MS;
        const hasIdle = verifiable.some((entry) => entry.state === "idle");
        if (!due && !hasIdle) return;
        if (!due && now - this.lastAutoVerify < AUTO_VERIFY_RETRY_MS) return;
        this.lastAutoVerify = now;
        void this.verifyAll(true);
      }

      async refresh() {
        if (this.disposed) return;
        const generation = ++this.generation;
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
        ]);
        try {
          const response = await fetch(SNAPSHOT_PATH, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            signal,
          });
          if (!response.ok) throw await responseError(response);
          const snapshot = await response.json();
          if (this.disposed || generation !== this.generation) return;
          if (
            snapshot === null ||
            typeof snapshot !== "object" ||
            !Array.isArray(snapshot.entries)
          ) {
            throw new Error(
              "The verification service returned an invalid snapshot.",
            );
          }
          this.setState({
            ...this.state,
            phase: "ready",
            snapshot,
            error: undefined,
            fetchedAt: Date.now(),
          });
        } catch (error) {
          if (
            this.disposed ||
            generation !== this.generation ||
            controller.signal.aborted
          )
            return;
          this.setState({
            ...this.state,
            phase: this.state.snapshot === undefined ? "error" : "ready",
            error: errorMessage(error),
          });
        }
      }

      async verifyAll(auto = false) {
        if (this.disposed)
          return {
            ok: false,
            message: "The verification page is no longer active.",
          };
        if (this.state.verifying) {
          return { ok: false, message: "A verification is already running." };
        }
        this.lastAutoVerify = Date.now();
        this.setState({
          ...this.state,
          verifying: true,
          verifyingAuto: auto,
          verifyError: undefined,
          error: auto ? this.state.error : undefined,
        });
        const controller = new AbortController();
        this.verifyController = controller;
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        ]);
        try {
          const response = await fetch(VERIFY_PATH, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: "{}",
            signal,
          });
          if (!response.ok) throw await responseError(response);
          const snapshot = await response.json();
          if (this.disposed)
            return {
              ok: false,
              message: "The verification page is no longer active.",
            };
          if (
            snapshot === null ||
            typeof snapshot !== "object" ||
            !Array.isArray(snapshot.entries)
          ) {
            throw new Error(
              "The verification service returned an invalid snapshot.",
            );
          }
          this.setState({
            ...this.state,
            phase: "ready",
            snapshot,
            error: undefined,
            fetchedAt: Date.now(),
            verifying: false,
            verifyingAuto: false,
            verifyError: undefined,
          });
          return { ok: true };
        } catch (error) {
          if (this.disposed)
            return {
              ok: false,
              message: "The verification page is no longer active.",
            };
          const message = errorMessage(error);
          this.setState({
            ...this.state,
            verifying: false,
            verifyingAuto: false,
            ...(auto ? { verifyError: message } : {}),
          });
          return { ok: false, message };
        } finally {
          if (this.verifyController === controller)
            this.verifyController = undefined;
        }
      }
    }

    // ---------------------------------------------------------------------
    // Helpers

    function responseError(response) {
      return response.json().then(
        (body) => errorFromResponse(response, body),
        () => errorFromResponse(response, undefined),
      );
    }

    function errorFromResponse(response, body) {
      if (response.status === 401 || response.status === 403) {
        return new Error("The Web session is not authorized. Reload the page.");
      }
      if (response.status === 404) {
        return new Error(
          "The verification service is not available in this host.",
        );
      }
      const message =
        body !== null &&
        typeof body === "object" &&
        typeof body.message === "string"
          ? body.message
          : `The verification request failed (${response.status}).`;
      return new Error(message);
    }

    function errorMessage(error) {
      if (error instanceof Error) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
          return "The verification request timed out.";
        }
        return error.message.length > 0
          ? error.message
          : "The verification request failed.";
      }
      return "The verification request failed.";
    }

    function mergeEntries(snapshot) {
      const entries =
        snapshot !== undefined &&
        snapshot !== null &&
        Array.isArray(snapshot.entries)
          ? snapshot.entries
          : [];
      const knownTargets =
        snapshot !== undefined &&
        snapshot !== null &&
        Array.isArray(snapshot.knownTargets)
          ? snapshot.knownTargets
          : [];
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const merged = [];
      for (const known of knownTargets) {
        const entry = byId.get(known.id);
        if (entry !== undefined) {
          merged.push(entry);
          byId.delete(known.id);
        } else {
          merged.push({
            id: known.id,
            title: known.title,
            state: "unavailable",
            mode: undefined,
            verifying: false,
            canVerify: false,
          });
        }
      }
      for (const entry of byId.values()) merged.push(entry);
      return merged;
    }

    function summarize(state) {
      const entries =
        state.snapshot !== undefined && Array.isArray(state.snapshot.entries)
          ? state.snapshot.entries
          : [];
      const counts = {
        total: entries.length,
        verified: 0,
        external: 0,
        optOut: 0,
        idle: 0,
        pending: 0,
        failed: 0,
      };
      for (const entry of entries) {
        if (entry.state === "verified") counts.verified += 1;
        else if (entry.state === "external") counts.external += 1;
        else if (entry.state === "unattested") counts.optOut += 1;
        else if (entry.state === "idle") counts.idle += 1;
        else if (entry.state === "pending") counts.pending += 1;
        else if (entry.state === "failed") counts.failed += 1;
      }
      const refreshFailed = state.error !== undefined;
      if (state.phase === "loading")
        return { kind: "loading", counts, refreshFailed: false };
      if (entries.length === 0)
        return { kind: "unavailable", counts, refreshFailed };
      if (state.verifying) return { kind: "verifying", counts, refreshFailed };
      if (counts.failed > 0 || refreshFailed)
        return { kind: "failure", counts, refreshFailed };
      if (counts.idle + counts.pending > 0)
        return { kind: "incomplete", counts, refreshFailed };
      if (counts.optOut > 0) {
        if (counts.verified + counts.external === 0)
          return { kind: "unattested", counts, refreshFailed };
        return { kind: "optOuts", counts, refreshFailed };
      }
      if (counts.external > 0) {
        if (counts.verified === 0)
          return { kind: "proxy", counts, refreshFailed };
        return { kind: "mixed", counts, refreshFailed };
      }
      return { kind: "strict", counts, refreshFailed };
    }

    function summaryText(summary, t) {
      switch (summary.kind) {
        case "strict":
          return t("summary.strict");
        case "verifying":
          return t("summary.verifying");
        case "proxy":
          return t("summary.proxy");
        case "mixed":
          return t("summary.mixed");
        case "optOuts":
          return t("summary.optOuts", { count: summary.counts.optOut });
        case "incomplete":
          return t("summary.incomplete", {
            count: summary.counts.idle + summary.counts.pending,
            total: summary.counts.total,
          });
        case "failure":
          if (summary.counts.failed === 0) return t("summary.refreshFailed");
          return t("summary.failure", {
            count: summary.counts.failed,
            total: summary.counts.total,
          });
        case "unattested":
          return t("summary.unattested");
        case "unavailable":
          if (summary.counts.total === 0 && !summary.refreshFailed)
            return t("summary.empty");
          return t("summary.unavailable");
        default:
          return t("summary.loading");
      }
    }

    function preferredId(entries) {
      for (const state of [
        "failed",
        "idle",
        "pending",
        "unattested",
        "verified",
        "external",
      ]) {
        const entry = entries.find((candidate) => candidate.state === state);
        if (entry !== undefined) return entry.id;
      }
      return entries[0]?.id;
    }

    function nextSelection(entries, current) {
      if (
        current !== undefined &&
        entries.some((entry) => entry.id === current)
      )
        return current;
      const selectable = entries.filter(
        (entry) => entry.state !== "unavailable",
      );
      return preferredId(selectable.length > 0 ? selectable : entries);
    }

    function displayTitle(entry, t) {
      const key = "target." + entry.id;
      const translated = t(key);
      return translated === key || translated.length === 0
        ? entry.title || entry.id
        : translated;
    }

    function emptyMessage(entry, t) {
      switch (entry.state) {
        case "idle":
          return t("empty.idle");
        case "pending":
          return t("empty.pending");
        case "failed":
          return entry.error ?? t("empty.failed");
        case "external":
          return t("empty.external");
        case "unattested":
          return t("empty.unattested");
        case "unavailable":
          return t("empty.unavailable");
        default:
          return t("empty.noDocument");
      }
    }

    function formatTime(value) {
      if (typeof value !== "string" || value.length === 0) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function valueOrNone(value, t) {
      return typeof value === "string" && value.length > 0
        ? value
        : t("value.none");
    }

    function openShape(kind) {
      return (
        kind === "incomplete" ||
        kind === "unattested" ||
        kind === "failure" ||
        kind === "unavailable" ||
        kind === "loading" ||
        kind === "verifying"
      );
    }

    function useDarkTheme(ctx) {
      const subscribe = useCallback(
        (callback) => ctx.on("theme/change", callback),
        [ctx],
      );
      const getSnapshot = useCallback(
        () => ctx.theme.getTheme().active.colorScheme === "dark",
        [ctx],
      );
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function useVerificationStore(store) {
      return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
      );
    }

    // ---------------------------------------------------------------------
    // Small components

    function LockIcon({ open, size }) {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        h("rect", { x: 5, y: 10.5, width: 14, height: 10, rx: 2.2 }),
        h("path", {
          d: open
            ? "M8.5 10.5V8a3.5 3.5 0 0 1 6.7-1.4"
            : "M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5",
        }),
        h("circle", {
          cx: 12,
          cy: 15.5,
          r: 1.15,
          fill: "currentColor",
          stroke: "none",
        }),
      );
    }

    function VerificationIcon({ size }) {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        h("path", {
          d: "M12 2.8 20 6v6.2c0 4.8-3.3 8.2-8 9.8-4.7-1.6-8-5-8-9.8V6z",
        }),
        h("path", { d: "m8.4 12 2.5 2.5 4.7-5" }),
      );
    }

    function StateDot({ state }) {
      return h("span", {
        className: "dsh-tv-dot",
        "data-state": state,
        "aria-hidden": "true",
      });
    }

    function MetaList({ entry, t, compact }) {
      const verification = entry.document;
      const rows = compact
        ? [
            [t("detail.mode"), t("mode." + (entry.mode ?? "none"))],
            [t("detail.enclave"), valueOrNone(entry.enclaveURL, t)],
            [t("detail.repo"), valueOrNone(entry.configRepo, t)],
          ]
        : [
            [t("detail.mode"), t("mode." + (entry.mode ?? "none"))],
            [t("detail.enclave"), valueOrNone(entry.enclaveURL, t)],
            [t("detail.repo"), valueOrNone(entry.configRepo, t)],
            [t("detail.release"), valueOrNone(verification?.releaseDigest, t)],
            [
              t("detail.verifiedAt"),
              formatTime(verification?.verifiedAt) ?? t("value.none"),
            ],
            [
              t("detail.codeFingerprint"),
              valueOrNone(verification?.codeFingerprint, t),
            ],
            [
              t("detail.enclaveFingerprint"),
              valueOrNone(verification?.enclaveFingerprint, t),
            ],
          ];
      return h(
        "dl",
        { className: "dsh-tv-meta" },
        rows.flatMap(([label, value], index) => [
          h("dt", { key: "dt" + index }, label),
          h("dd", { key: "dd" + index }, h("code", null, value)),
        ]),
      );
    }

    function StepList({ entry, t }) {
      const verification = entry.document;
      const steps = verification?.steps;
      if (steps === undefined || steps === null) return null;
      const items = [];
      for (const key of STEP_KEYS) {
        const step = steps[key];
        if (step === undefined || step === null) continue;
        items.push(
          h(
            "li",
            {
              key,
              className: "dsh-tv-step",
              "data-status": step.status,
              title: step.error ?? undefined,
            },
            t("step." + key) + ": " + t("step." + step.status),
          ),
        );
      }
      if (items.length === 0) return null;
      return h(
        "div",
        {
          style: { display: "flex", flexDirection: "column", gap: "6px" },
        },
        h("span", { className: "dsh-tv-row-state" }, t("detail.steps")),
        h("ul", { className: "dsh-tv-steps" }, items),
      );
    }

    function VerificationFrame({ entry, dark, t, title }) {
      const iframeRef = useRef(null);
      const readyRef = useRef(false);
      const documentRef = useRef(entry.document);
      const src = CENTER_URL + "&darkMode=" + (dark ? "true" : "false");

      const send = useCallback(() => {
        const frame = iframeRef.current;
        const verification = documentRef.current;
        if (
          frame === null ||
          verification === undefined ||
          frame.contentWindow === null
        )
          return;
        frame.contentWindow.postMessage(
          {
            type: "TINFOIL_VERIFICATION_DOCUMENT",
            document: verification,
          },
          CENTER_ORIGIN,
        );
      }, []);

      useEffect(() => {
        documentRef.current = entry.document;
        if (readyRef.current) send();
      }, [entry.document, send]);

      useEffect(() => {
        const onMessage = (event) => {
          if (event.origin !== CENTER_ORIGIN) return;
          const frame = iframeRef.current;
          if (frame === null || event.source !== frame.contentWindow) return;
          const type =
            event.data !== null && typeof event.data === "object"
              ? event.data.type
              : undefined;
          if (
            type === "TINFOIL_VERIFICATION_CENTER_READY" ||
            type === "TINFOIL_REQUEST_VERIFICATION_DOCUMENT"
          ) {
            readyRef.current = true;
            send();
          }
        };
        window.addEventListener("message", onMessage);
        return () => {
          window.removeEventListener("message", onMessage);
        };
      }, [send]);

      const onLoad = useCallback(() => {
        readyRef.current = false;
        send();
      }, [send]);

      return h(
        "div",
        { className: "dsh-tv-frame" },
        h("iframe", {
          ref: iframeRef,
          className: "dsh-tv-iframe",
          src,
          title: t("iframe.title", { plugin: title }),
          referrerPolicy: "no-referrer",
          sandbox:
            "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
          onLoad,
        }),
        h("p", { className: "dsh-tv-hint" }, t("iframe.hint")),
      );
    }

    // ---------------------------------------------------------------------
    // Settings page

    function SettingsSection({ ctx, t, store }) {
      const state = useVerificationStore(store);
      const dark = useDarkTheme(ctx);
      const [selectedId, setSelectedId] = useState(undefined);
      const [nonce, setNonce] = useState(0);
      const [actionError, setActionError] = useState(undefined);
      const entries = useMemo(
        () => mergeEntries(state.snapshot),
        [state.snapshot],
      );
      const summary = summarize(state);
      const hasVerifiable = entries.some((entry) => entry.canVerify === true);
      const fallbackId = nextSelection(entries, undefined);
      const selected =
        entries.find((entry) => entry.id === selectedId) ??
        entries.find((entry) => entry.id === fallbackId) ??
        entries[0];

      useEffect(() => {
        if (state.snapshot === undefined) return;
        setSelectedId((current) => nextSelection(entries, current));
      }, [entries, state.snapshot]);

      useEffect(() => {
        setActionError(undefined);
      }, [selectedId]);

      const verifyAll = useCallback(async () => {
        setActionError(undefined);
        const result = await store.verifyAll(false);
        if (!result.ok) setActionError(result.message);
      }, [store]);

      const checkStatus = useCallback(async () => {
        setActionError(undefined);
        await store.refresh();
      }, [store]);

      const header = h(
        "header",
        { className: "dsh-tv-header" },
        h("h2", { className: "dsh-tv-title" }, t("section.title")),
        h(
          "p",
          { className: "dsh-tv-intro" },
          t("section.intro"),
          " ",
          h(
            "a",
            {
              className: "dsh-tv-link",
              href: DOCS_URL,
              target: "_blank",
              rel: "noreferrer noopener",
            },
            t("section.docs"),
          ),
        ),
      );

      if (state.snapshot === undefined) {
        return h(
          "section",
          { className: "dsh-tv-section" },
          h("style", null, CSS),
          header,
          state.phase === "error"
            ? h(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  },
                },
                h(
                  "p",
                  { className: "dsh-tv-error", role: "alert" },
                  t("error.refresh", { message: state.error }),
                ),
                h(
                  "div",
                  { className: "dsh-tv-actions", style: { marginLeft: 0 } },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dsh-tv-button",
                      onClick: () => {
                        void checkStatus();
                      },
                    },
                    t("action.refreshStatus"),
                  ),
                ),
              )
            : h("p", { className: "dsh-tv-empty" }, t("empty.loading")),
        );
      }

      const frameKey =
        selected === undefined
          ? "none"
          : selected.id + "|" + (dark ? "dark" : "light") + "|" + nonce;
      const lastChecked =
        state.fetchedAt === undefined
          ? undefined
          : formatTime(new Date(state.fetchedAt).toISOString());

      return h(
        "section",
        { className: "dsh-tv-section" },
        h("style", null, CSS),
        header,
        h(
          "div",
          { className: "dsh-tv-summary" },
          h(
            "span",
            { className: "dsh-tv-badge", "data-state": summary.kind },
            summaryText(summary, t),
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsh-tv-button",
              "data-primary": "true",
              disabled: !hasVerifiable || state.verifying,
              onClick: () => {
                void verifyAll();
              },
            },
            state.verifying ? t("action.verifyingAll") : t("action.verifyAll"),
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsh-tv-button",
              title: t("action.refreshHint"),
              onClick: () => {
                void checkStatus();
              },
            },
            t("action.refreshStatus"),
          ),
        ),
        h(
          "p",
          { className: "dsh-tv-row-state" },
          t("status.auto"),
          lastChecked === undefined
            ? ""
            : " " + t("status.lastChecked", { time: lastChecked }),
        ),
        h("p", { className: "dsh-tv-hint" }, t("action.refreshHint")),
        state.error === undefined
          ? null
          : h(
              "p",
              { className: "dsh-tv-error", role: "alert" },
              t("error.refresh", { message: state.error }),
            ),
        state.verifyError === undefined
          ? null
          : h(
              "p",
              { className: "dsh-tv-error", role: "alert" },
              t("error.verify", { message: state.verifyError }),
            ),
        actionError === undefined
          ? null
          : h(
              "p",
              { className: "dsh-tv-error", role: "alert" },
              t("error.verify", { message: actionError }),
            ),
        h(
          "div",
          { className: "dsh-tv-layout" },
          h(
            "div",
            {
              className: "dsh-tv-list",
              role: "group",
              "aria-label": t("section.list"),
            },
            entries.map((entry) =>
              h(
                "button",
                {
                  key: entry.id,
                  type: "button",
                  className: "dsh-tv-row",
                  "data-active": selected?.id === entry.id ? "true" : undefined,
                  "aria-pressed": selected?.id === entry.id ? "true" : "false",
                  onClick: () => {
                    setSelectedId(entry.id);
                  },
                },
                h(StateDot, { state: entry.state }),
                h(
                  "span",
                  { className: "dsh-tv-row-main" },
                  h(
                    "span",
                    { className: "dsh-tv-row-title" },
                    displayTitle(entry, t),
                  ),
                  h(
                    "span",
                    { className: "dsh-tv-row-state" },
                    t("state." + entry.state),
                    entry.mode === undefined
                      ? ""
                      : " · " + t("mode." + entry.mode),
                  ),
                ),
              ),
            ),
          ),
          selected === undefined
            ? h(
                "section",
                { className: "dsh-tv-detail" },
                h("p", { className: "dsh-tv-empty" }, t("empty.unavailable")),
              )
            : h(
                "section",
                { className: "dsh-tv-detail" },
                h(
                  "div",
                  { className: "dsh-tv-detail-head" },
                  h(
                    "h3",
                    { className: "dsh-tv-detail-title" },
                    displayTitle(selected, t),
                  ),
                  h(
                    "span",
                    { className: "dsh-tv-badge", "data-state": selected.state },
                    t("state." + selected.state),
                  ),
                  h(
                    "div",
                    { className: "dsh-tv-actions" },
                    selected.document === undefined
                      ? null
                      : h(
                          "button",
                          {
                            type: "button",
                            className: "dsh-tv-button",
                            onClick: () => {
                              setNonce((value) => value + 1);
                            },
                          },
                          t("action.reload"),
                        ),
                  ),
                ),
                h(MetaList, { entry: selected, t }),
                h(StepList, { entry: selected, t }),
                selected.error === undefined
                  ? null
                  : h(
                      "p",
                      { className: "dsh-tv-error", role: "alert" },
                      t("error.verify", { message: selected.error }),
                    ),
                selected.document === undefined
                  ? h(
                      "p",
                      { className: "dsh-tv-empty" },
                      emptyMessage(selected, t),
                    )
                  : h(VerificationFrame, {
                      key: frameKey,
                      entry: selected,
                      dark,
                      t,
                      title: displayTitle(selected, t),
                    }),
              ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Composer status-bar lock and popover

    function DockLock({ ctx, t, store }) {
      const state = useVerificationStore(store);
      const dark = useDarkTheme(ctx);
      const popoverId = useId();
      const [open, setOpen] = useState(false);
      const [selectedId, setSelectedId] = useState(undefined);
      const [actionError, setActionError] = useState(undefined);
      const [anchor, setAnchor] = useState(undefined);
      const rootRef = useRef(null);
      const triggerRef = useRef(null);
      const panelRef = useRef(null);
      const closeRef = useRef(null);
      const focusedRef = useRef(false);
      const entries = useMemo(
        () => mergeEntries(state.snapshot),
        [state.snapshot],
      );
      const summary = summarize(state);
      const hasVerifiable = entries.some((entry) => entry.canVerify === true);
      const fallbackId = nextSelection(entries, undefined);
      const selected =
        entries.find((entry) => entry.id === selectedId) ??
        entries.find((entry) => entry.id === fallbackId) ??
        entries[0];
      const summaryLabel = summaryText(summary, t);

      useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
          const trigger = triggerRef.current;
          if (trigger === null) return;
          const rect = trigger.getBoundingClientRect();
          const width = Math.min(444, Math.max(280, window.innerWidth - 24));
          const left = Math.max(
            12,
            Math.min(rect.left, window.innerWidth - width - 12),
          );
          const maxHeight = Math.max(320, Math.min(720, rect.top - 12));
          setAnchor({
            left,
            bottom: window.innerHeight - rect.top + 8,
            width,
            maxHeight,
          });
        };
        place();
        window.addEventListener("resize", place);
        return () => {
          window.removeEventListener("resize", place);
        };
      }, [open]);

      useEffect(() => {
        if (!open) {
          focusedRef.current = false;
          return;
        }
        if (anchor === undefined || focusedRef.current) return;
        focusedRef.current = true;
        closeRef.current?.focus();
      }, [open, anchor]);

      useEffect(() => {
        if (!open || state.snapshot === undefined) return;
        setSelectedId((current) => nextSelection(entries, current));
      }, [open, entries, state.snapshot]);

      useEffect(() => {
        setActionError(undefined);
      }, [selectedId]);

      useEffect(() => {
        if (!open) return;
        const onPointer = (event) => {
          const target = event.target;
          const trigger = rootRef.current;
          const panel = panelRef.current;
          const insideTrigger = trigger !== null && trigger.contains(target);
          const insidePanel = panel !== null && panel.contains(target);
          if (!insideTrigger && !insidePanel) setOpen(false);
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        };
        document.addEventListener("pointerdown", onPointer, true);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("pointerdown", onPointer, true);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      const verifyAll = useCallback(async () => {
        setActionError(undefined);
        const result = await store.verifyAll(false);
        if (!result.ok) setActionError(result.message);
      }, [store]);

      const checkStatus = useCallback(async () => {
        setActionError(undefined);
        await store.refresh();
      }, [store]);

      const close = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
      }, []);

      const panel =
        open && anchor !== undefined
          ? ReactDOM.createPortal(
              h(
                "div",
                {
                  id: popoverId,
                  ref: panelRef,
                  role: "dialog",
                  "aria-label": t("popover.title"),
                  className: "dsh-tv-popover",
                  style: {
                    left: anchor.left,
                    bottom: anchor.bottom,
                    width: anchor.width,
                    maxHeight: anchor.maxHeight,
                  },
                },
                h(
                  "div",
                  { className: "dsh-tv-popover-head" },
                  h(
                    "span",
                    {
                      className: "dsh-tv-lock-icon",
                      "data-state": summary.kind,
                    },
                    h(LockIcon, { open: openShape(summary.kind), size: 18 }),
                  ),
                  h(
                    "h2",
                    { className: "dsh-tv-popover-title" },
                    t("popover.title"),
                  ),
                  h(
                    "button",
                    {
                      ref: closeRef,
                      type: "button",
                      className: "dsh-tv-button dsh-tv-close",
                      "aria-label": t("action.close"),
                      onClick: close,
                    },
                    h("span", { "aria-hidden": "true" }, "×"),
                  ),
                ),
                h("p", { className: "dsh-tv-popover-summary" }, summaryLabel),
                h(
                  "p",
                  { className: "dsh-tv-popover-summary" },
                  t("status.auto"),
                  state.fetchedAt === undefined
                    ? ""
                    : " " +
                        t("status.lastChecked", {
                          time: formatTime(
                            new Date(state.fetchedAt).toISOString(),
                          ),
                        }),
                ),
                state.snapshot === undefined
                  ? h(
                      "div",
                      { className: "dsh-tv-popover-detail" },
                      state.phase === "error"
                        ? h(
                            "p",
                            { className: "dsh-tv-error", role: "alert" },
                            t("error.refresh", { message: state.error }),
                          )
                        : h(
                            "p",
                            { className: "dsh-tv-empty" },
                            t("empty.loading"),
                          ),
                      h(
                        "div",
                        {
                          className: "dsh-tv-actions",
                          style: { marginLeft: 0 },
                        },
                        h(
                          "button",
                          {
                            type: "button",
                            className: "dsh-tv-button",
                            onClick: () => {
                              void checkStatus();
                            },
                          },
                          t("action.refreshStatus"),
                        ),
                      ),
                    )
                  : h(
                      "div",
                      { className: "dsh-tv-popover-detail" },
                      h(
                        "div",
                        { className: "dsh-tv-popover-controls" },
                        h(
                          "select",
                          {
                            className: "dsh-tv-select",
                            value: selected?.id ?? "",
                            "aria-label": t("section.list"),
                            onChange: (event) => {
                              setSelectedId(event.target.value);
                              setActionError(undefined);
                            },
                          },
                          entries.map((entry) =>
                            h(
                              "option",
                              {
                                key: entry.id,
                                value: entry.id,
                              },
                              displayTitle(entry, t) +
                                " — " +
                                t("state." + entry.state),
                            ),
                          ),
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            className: "dsh-tv-button",
                            title: t("action.refreshHint"),
                            onClick: () => {
                              void checkStatus();
                            },
                          },
                          t("action.refreshStatus"),
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            className: "dsh-tv-button",
                            "data-primary": "true",
                            disabled: !hasVerifiable || state.verifying,
                            onClick: () => {
                              void verifyAll();
                            },
                          },
                          state.verifying
                            ? t("action.verifyingAll")
                            : t("action.verifyAll"),
                        ),
                      ),
                      state.error === undefined
                        ? null
                        : h(
                            "p",
                            { className: "dsh-tv-error", role: "alert" },
                            t("error.refresh", { message: state.error }),
                          ),
                      state.verifyError === undefined
                        ? null
                        : h(
                            "p",
                            { className: "dsh-tv-error", role: "alert" },
                            t("error.verify", { message: state.verifyError }),
                          ),
                      actionError === undefined
                        ? null
                        : h(
                            "p",
                            { className: "dsh-tv-error", role: "alert" },
                            t("error.verify", { message: actionError }),
                          ),
                      selected === undefined
                        ? h(
                            "p",
                            { className: "dsh-tv-empty" },
                            t("empty.unavailable"),
                          )
                        : h(
                            "div",
                            null,
                            h(MetaList, { entry: selected, t, compact: true }),
                            selected.error === undefined
                              ? null
                              : h(
                                  "p",
                                  { className: "dsh-tv-error", role: "alert" },
                                  t("error.verify", {
                                    message: selected.error,
                                  }),
                                ),
                            selected.document === undefined
                              ? h(
                                  "p",
                                  {
                                    className: "dsh-tv-empty",
                                    style: { marginTop: "8px" },
                                  },
                                  emptyMessage(selected, t),
                                )
                              : h(VerificationFrame, {
                                  key:
                                    selected.id +
                                    "|" +
                                    (dark ? "dark" : "light"),
                                  entry: selected,
                                  dark,
                                  t,
                                  title: displayTitle(selected, t),
                                }),
                          ),
                    ),
              ),
              document.body,
            )
          : null;

      return h(
        React.Fragment,
        null,
        h("style", null, CSS),
        h(
          "span",
          {
            ref: rootRef,
            className: "dsh-tv-dock-anchor",
          },
          h(
            "button",
            {
              ref: triggerRef,
              type: "button",
              className: "dsh-tv-dock-pill",
              "data-active": open ? "true" : undefined,
              "aria-label": t("lock.aria", { summary: summaryLabel }),
              title: t("lock.aria", { summary: summaryLabel }),
              "aria-haspopup": "dialog",
              "aria-expanded": open ? "true" : "false",
              ...(open ? { "aria-controls": popoverId } : {}),
              onClick: () => {
                setActionError(undefined);
                setOpen((value) => !value);
              },
            },
            h(
              "span",
              { className: "dsh-tv-lock-icon", "data-state": summary.kind },
              h(LockIcon, { open: openShape(summary.kind), size: 14 }),
            ),
            h("span", { className: "dsh-tv-dock-label" }, t("lock.title")),
          ),
          panel,
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Plugin

    return {
      inject: ["slots", "locale", "theme"],
      apply(ctx) {
        const store = new VerificationStore();
        const t = ctx.locale.bind(NS);
        ctx.effect(
          () => ctx.locale.register(NS, { en: DICT }),
          "tinfoil-verification: dictionaries",
        );
        ctx.effect(() => {
          store.start();
          return () => {
            store.dispose();
          };
        }, "tinfoil-verification: store");
        ctx.effect(
          () =>
            ctx.slots.inject("conversation.composer.dock", () =>
              ctx.slots.register(
                {
                  name: "conversation.composer.dock",
                  id: "tinfoil-lock",
                  order: -1,
                  locale: NS,
                },
                (props) => h(DockLock, { ...props, ctx, t, store }),
              ),
            ),
          "tinfoil-verification: composer lock",
        );
        ctx.effect(
          () =>
            ctx.slots.inject("settings.section", () =>
              ctx.slots.register(
                {
                  name: "settings.section",
                  id: "tinfoil",
                  order: 25,
                  label: () => t("nav"),
                  locale: NS,
                },
                (props) => h(SettingsSection, { ...props, ctx, t, store }),
              ),
            ),
          "tinfoil-verification: settings page",
        );
        ctx.effect(
          () =>
            ctx.slots.inject("settings.section.icon", () =>
              ctx.slots.register(
                {
                  name: "settings.section.icon",
                  id: "tinfoil",
                  order: 0,
                },
                VerificationIcon,
              ),
            ),
          "tinfoil-verification: settings icon",
        );
      },
    };
  },
});

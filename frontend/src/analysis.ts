import type { Job, Project } from "./types";
import { normalizeNote } from "./arrangement";

/** Deliver notation exactly once without reloading audio or overwriting edits. */
export function mergeAnalysis(project: Project, job: Job): Project {
  if (project.jobId !== job.id) return project;
  const pending = ["waiting", "queued", "running"].includes(job.analysis_state || "");
  const result = job.result;
  const revision = result?.analysis_revision;
  if (!result || !revision || revision === project.analysisRevision ||
      job.analysis_state !== "ready" || project.jobResultId !== job.id)
    return { ...project, analysisPending: pending };
  const manual = project.cues.filter(c => c.source === "manual");
  return {
    ...project,
    analysisPending: false,
    analysisRevision: revision,
    ...(!project.timingEdited ? { bpm: result.bpm, timing: result.timing } : {}),
    ...(!project.harmonyEdited && !manual.length ? {
      harmony: result.chords.filter(c => c.label !== "N"),
      cues: result.chords.filter(c => c.label !== "N").map(c => ({
        id: crypto.randomUUID(), text: c.label, start: c.start, end: c.end, source: "ai" as const,
      })),
    } : {}),
    tracks: project.tracks.map(track => {
      const generated = result.tracks.find(t => t.kind === track.kind);
      return generated && !track.notesEdited
        ? { ...track, notes: generated.notes?.map(normalizeNote) }
        : track;
    }),
  };
}

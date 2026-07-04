import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AnalysisGraph,
  AnalysisJob,
  AnalysisJobSummary,
  AnalysisPhase,
  AnalysisProgressEvent,
  RepoSource,
} from '@codeviz/shared';
import { analyzeRepo } from '@codeviz/analyzer';
import { config } from './config.js';

/**
 * In-memory job store. Jobs are transient; finished graphs travel with the
 * job and are also embedded in saved diagrams' analyses on disk by the caller.
 */
class JobManager {
  private jobs = new Map<string, AnalysisJob>();
  readonly events = new EventEmitter();

  create(source: RepoSource, skipEnrichment: boolean): AnalysisJob {
    const job: AnalysisJob = {
      id: randomUUID(),
      source,
      phase: 'queued',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    // Fire and forget; errors land on the job record.
    void this.run(job, skipEnrichment);
    return job;
  }

  get(id: string): AnalysisJob | undefined {
    return this.jobs.get(id);
  }

  summary(job: AnalysisJob): AnalysisJobSummary {
    const { graph: _graph, ...rest } = job;
    return rest;
  }

  private emitProgress(id: string, ev: AnalysisProgressEvent) {
    this.events.emit(`progress:${id}`, ev);
  }

  private setPhase(job: AnalysisJob, phase: AnalysisPhase, message: string, progress?: number) {
    job.phase = phase;
    this.emitProgress(job.id, { phase, message, progress });
  }

  private async run(job: AnalysisJob, skipEnrichment: boolean) {
    try {
      const graph: AnalysisGraph = await analyzeRepo(job.source, {
        repoCacheDir: config.repoCacheDir,
        anthropicApiKey: skipEnrichment ? undefined : config.anthropicApiKey,
        onProgress: (ev) => this.setPhase(job, ev.phase, ev.message, ev.progress),
      });
      job.graph = graph;
      this.setPhase(job, 'done', 'Analysis complete');
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      this.setPhase(job, 'error', job.error);
    }
  }
}

export const jobManager = new JobManager();

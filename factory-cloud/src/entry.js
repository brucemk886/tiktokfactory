import { WorkflowEntrypoint } from 'cloudflare:workers';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
import { runGeminiVideoWorkflow } from './gemini-video-workflow.js';
import { runPsychologyRecreationWorkflow } from './psychology-recreation-workflow.js';
export { TikTokDownloaderContainer } from './tiktok-downloader-container.js';
export { default } from './index.js';

export class PeerPhotoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runPeerPhotoWorkflow(this.env, event, step);
  }
}

export class GeminiVideoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runGeminiVideoWorkflow(this.env, event, step);
  }
}

export class PsychologyRecreationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runPsychologyRecreationWorkflow(this.env, event, step);
  }
}

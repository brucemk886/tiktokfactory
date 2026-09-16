import { WorkflowEntrypoint } from 'cloudflare:workers';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
import { runGeminiVideoWorkflow } from './gemini-video-workflow.js';
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

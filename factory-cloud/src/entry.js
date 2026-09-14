import { WorkflowEntrypoint } from 'cloudflare:workers';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
export { default } from './index.js';

export class PeerPhotoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return runPeerPhotoWorkflow(this.env, event, step);
  }
}

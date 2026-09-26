import {runCopyExtraction} from './psychology-copy-workflow.js';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { enqueueAutoPhotoRender } from './psychology-auto-publish.js';
import { runPeerPhotoWorkflow } from './peer-photo-workflow.js';
import { runGeminiVideoWorkflow } from './gemini-video-workflow.js';
import { runPsychologyRecreationWorkflow } from './psychology-recreation-workflow.js';
export { default } from './index.js';

export class PeerPhotoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const result = await runPeerPhotoWorkflow(this.env, event, step);
    await step.do('enqueue-auto-photo-render', () => enqueueAutoPhotoRender(this.env, event.payload.jobId));
    return result;
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

export class PsychologyCopyWorkflow extends WorkflowEntrypoint {
  async run(event,step){return runCopyExtraction(this.env,event,step);}
}

export class PhotoFactoryWorkflow extends WorkflowEntrypoint {
 async run(event,step){return (await import('./photo-factory-execution.js')).runPhotoFactoryWorkflow(this.env,event,step);}
}

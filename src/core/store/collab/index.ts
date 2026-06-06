//! Collaborative store layer — public API.
//!
//! Usage:
//!   import { ProjectCollabDoc } from '@store/collab';
//!   const doc = new ProjectCollabDoc(projectId, localUser);
//!   doc.connectTransport((update) => sendToPeer(update));

export {
  ProjectCollabDoc,
  type CollabUser,
  type TransportHandler,
} from './provider';

export {
  setRagChunks,
  getRagChunks,
  observeRagChunks,
  pushRagChunk,
  setManuscript,
  getManuscript,
  observeManuscript,
  setAnnotations,
  getAnnotations,
  observeAnnotations,
  pushAnnotation,
  getProjectSyncState,
  setProjectSyncState,
  type BrainAnnotation,
  type ProjectSyncState,
} from './sync';

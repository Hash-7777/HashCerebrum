import * as Y from 'yjs';

export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

export type TransportHandler = (update: Uint8Array) => void;

export class ProjectCollabDoc {
  readonly projectId: string;
  readonly doc: Y.Doc;
  readonly awareness: Y.Map<unknown>;
  private _transportSend: TransportHandler | null = null;
  private _updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private _destroyed = false;

  constructor(projectId: string, localUser: CollabUser) {
    this.projectId = projectId;
    this.doc = new Y.Doc();
    this.awareness = this.doc.getMap('awareness');
    this.awareness.set(localUser.id, { user: localUser, timestamp: Date.now() });

    this._updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      this._transportSend?.(update);
    };
    this.doc.on('update', this._updateHandler);
  }

  connectTransport(send: TransportHandler): void {
    this._transportSend = send;
  }

  disconnectTransport(): void {
    this._transportSend = null;
  }

  applyUpdate(update: Uint8Array): void {
    if (this._destroyed) return;
    Y.applyUpdate(this.doc, update, 'remote');
  }

  encodeStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._updateHandler) {
      this.doc.off('update', this._updateHandler);
    }
    this._transportSend = null;
    this.doc.destroy();
  }

  get destroyed(): boolean {
    return this._destroyed;
  }
}

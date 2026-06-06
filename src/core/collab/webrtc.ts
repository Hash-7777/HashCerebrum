export interface CursorPayload {
  x: number;
  y: number;
  userId: string;
  userName: string;
  color: string;
}

export interface SelectedEvidencePayload {
  evidenceId: string;
  userId: string;
}

export interface ActiveSectionPayload {
  sectionHeading: string;
  userId: string;
}

export type MeshPayload =
  | { type: 'cursor'; data: CursorPayload }
  | { type: 'selectedEvidence'; data: SelectedEvidencePayload }
  | { type: 'activeSection'; data: ActiveSectionPayload };

export interface SignalBlob {
  type: 'offer' | 'answer';
  from: string;
  fromName: string;
  to: string;
  sdp: string;
  candidates: RTCIceCandidateInit[];
}

export interface IncomingOffer {
  peerId: string;
  peerName: string;
  offerBlob: string;
}

interface PeerInfo {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  name: string;
  approved: boolean;
}

export class WebRTCMesh {
  private peers = new Map<string, PeerInfo>();
  private _localId = crypto.randomUUID();
  private _localName = 'Researcher';
  private _iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private _onMessage: ((msg: MeshPayload) => void) | null = null;
  private _onPeerConnected: ((peerId: string, peerName: string) => void) | null = null;
  private _onPeerDisconnected: ((peerId: string) => void) | null = null;
  private _onApprovalRequired: ((offer: IncomingOffer) => void) | null = null;
  private _pendingOfferPeerId: string | null = null;

  constructor(options?: {
    peerName?: string;
    iceServers?: RTCIceServer[];
    onMessage?: (msg: MeshPayload) => void;
    onPeerConnected?: (peerId: string, peerName: string) => void;
    onPeerDisconnected?: (peerId: string) => void;
    onApprovalRequired?: (offer: IncomingOffer) => void;
  }) {
    if (options?.peerName) this._localName = options.peerName;
    if (options?.iceServers) this._iceServers = options.iceServers;
    this._onMessage = options?.onMessage ?? null;
    this._onPeerConnected = options?.onPeerConnected ?? null;
    this._onPeerDisconnected = options?.onPeerDisconnected ?? null;
    this._onApprovalRequired = options?.onApprovalRequired ?? null;
  }

  get localId(): string {
    return this._localId;
  }

  get localName(): string {
    return this._localName;
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.keys()].filter(
      (id) => this.peers.get(id)?.channel?.readyState === 'open',
    );
  }

  async createOffer(): Promise<string> {
    const tempPeerId = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const channel = pc.createDataChannel('hashcerebrum', { ordered: true });

    this.peers.set(tempPeerId, { pc, channel: null, name: '', approved: true });
    this._setupPeerConnection(tempPeerId, pc);
    this._setupDataChannel(tempPeerId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const candidates = await this._gatherIceCandidates(pc);
    this._pendingOfferPeerId = tempPeerId;

    const blob: SignalBlob = {
      type: 'offer',
      from: this._localId,
      fromName: this._localName,
      to: tempPeerId,
      sdp: pc.localDescription!.sdp,
      candidates,
    };
    return JSON.stringify(blob);
  }

  receiveOffer(offerBlob: string): void {
    const blob: SignalBlob = JSON.parse(offerBlob);
    if (blob.type !== 'offer') {
      throw new Error('Expected offer blob');
    }
    this._onApprovalRequired?.({
      peerId: blob.from,
      peerName: blob.fromName,
      offerBlob,
    });
  }

  async approveAndCreateAnswer(offerBlob: string): Promise<string> {
    const blob: SignalBlob = JSON.parse(offerBlob);
    const peerId = blob.from;

    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this.peers.set(peerId, { pc, channel: null, name: blob.fromName, approved: true });
    this._setupPeerConnection(peerId, pc);

    pc.ondatachannel = (event) => {
      const info = this.peers.get(peerId);
      if (info) {
        info.channel = event.channel;
      }
      this._setupDataChannel(peerId, event.channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: blob.sdp }));
    for (const cand of blob.candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const candidates = await this._gatherIceCandidates(pc);

    const answerBlob: SignalBlob = {
      type: 'answer',
      from: this._localId,
      fromName: this._localName,
      to: blob.from,
      sdp: pc.localDescription!.sdp,
      candidates,
    };
    return JSON.stringify(answerBlob);
  }

  async acceptAnswer(answerBlob: string): Promise<void> {
    const blob: SignalBlob = JSON.parse(answerBlob);
    if (blob.type !== 'answer') {
      throw new Error('Expected answer blob');
    }

    const targetPeerId = this._pendingOfferPeerId;
    this._pendingOfferPeerId = null;

    if (targetPeerId === null) {
      throw new Error('No matching pending offer');
    }

    const info = this.peers.get(targetPeerId);
    if (!info) {
      throw new Error('No matching pending offer');
    }

    await info.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: blob.sdp }));
    for (const cand of blob.candidates) {
      await info.pc.addIceCandidate(new RTCIceCandidate(cand));
    }

    // Migrate from temporary id to real peer id.
    const newInfo: PeerInfo = { ...info, name: blob.fromName };
    this.peers.delete(targetPeerId);
    this.peers.set(blob.from, newInfo);
  }

  rejectPeer(peerId: string): void {
    this._closePeer(peerId);
  }

  disconnectPeer(peerId: string): void {
    this._closePeer(peerId);
  }

  disconnectAll(): void {
    for (const peerId of [...this.peers.keys()]) {
      this._closePeer(peerId);
    }
  }

  broadcast(payload: MeshPayload): void {
    const msg = JSON.stringify(payload);
    for (const [, info] of this.peers) {
      if (info.approved && info.channel && info.channel.readyState === 'open') {
        info.channel.send(msg);
      }
    }
  }

  private _setupPeerConnection(peerId: string, pc: RTCPeerConnection): void {
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        const info = this.peers.get(peerId);
        this._onPeerConnected?.(peerId, info?.name ?? '');
      } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        this._onPeerDisconnected?.(peerId);
        this._closePeer(peerId);
      }
    };
  }

  private _setupDataChannel(peerId: string, channel: RTCDataChannel): void {
    channel.onopen = () => {
      const info = this.peers.get(peerId);
      if (info) {
        info.channel = channel;
      }
    };
    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as MeshPayload;
        this._onMessage?.(msg);
      } catch {
        // Ignore malformed messages
      }
    };
    channel.onclose = () => {
      const info = this.peers.get(peerId);
      if (info) {
        info.channel = null;
      }
    };
  }

  private _closePeer(peerId: string): void {
    const info = this.peers.get(peerId);
    if (!info) return;
    info.pc.close();
    this.peers.delete(peerId);
  }

  private _gatherIceCandidates(pc: RTCPeerConnection): Promise<RTCIceCandidateInit[]> {
    return new Promise((resolve) => {
      const candidates: RTCIceCandidateInit[] = [];
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates.push(event.candidate.toJSON());
        } else {
          resolve(candidates);
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve(candidates);
        }
      };
      setTimeout(() => resolve(candidates), 8000);
    });
  }
}

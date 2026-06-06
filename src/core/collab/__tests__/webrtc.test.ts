// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { WebRTCMesh } from '../webrtc';

class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  iceGatheringState: RTCIceGatheringState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: FakeRTCDataChannel }) => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  private _channels: FakeRTCDataChannel[] = [];

  constructor(_config?: RTCConfiguration) {}

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'offer', sdp: 'fake-offer' });
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'answer', sdp: 'fake-answer' });
  }

  async setLocalDescription(desc?: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc ?? null;
    this.signalingState = desc?.type === 'offer' ? 'have-local-offer' : 'stable';
    this.iceGatheringState = 'complete';
    queueMicrotask(() => {
      this.onicegatheringstatechange?.();
      this.onicecandidate?.({ candidate: null });
    });
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'answer') {
      this.signalingState = 'stable';
      this.connectionState = 'connected';
      this._channels.forEach((ch) => ch._simulateOpen());
      queueMicrotask(() => {
        this.onconnectionstatechange?.();
      });
    }
  }

  addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    return Promise.resolve();
  }

  createDataChannel(label: string, _opts?: RTCDataChannelInit): FakeRTCDataChannel {
    const ch = new FakeRTCDataChannel(label);
    this._channels.push(ch);
    return ch;
  }

  close(): void {
    this.connectionState = 'closed';
  }

  _getChannels(): FakeRTCDataChannel[] {
    return this._channels;
  }
}

class FakeRTCDataChannel {
  label: string;
  readyState: RTCDataChannelState = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  private _sent: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    this._sent.push(data);
  }

  _simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  _simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  _getSent(): string[] {
    return this._sent;
  }
}

class FakeRTCIceCandidate implements RTCIceCandidate {
  candidate = 'fake';
  sdpMid = '0';
  sdpMLineIndex = 0;
  foundation = '';
  component: RTCIceComponent = 'rtp';
  priority = 0;
  address = '';
  protocol: RTCIceProtocol = 'udp';
  port = 0;
  type: RTCIceCandidateType = 'host';
  tcpType: RTCIceTcpCandidateType | null = null;
  relatedAddress: string | null = null;
  relatedPort: number | null = null;
  usernameFragment: string | null = null;

  toJSON(): RTCIceCandidateInit {
    return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex };
  }
}

vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
vi.stubGlobal('RTCSessionDescription', class {
  type: RTCSdpType;
  sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type as RTCSdpType;
    this.sdp = init.sdp ?? '';
  }
});
vi.stubGlobal('RTCIceCandidate', FakeRTCIceCandidate);

describe('WebRTCMesh', () => {
  it('initializes with local identity', () => {
    const mesh = new WebRTCMesh({ peerName: 'Researcher-1' });
    expect(mesh.localName).toBe('Researcher-1');
    expect(mesh.localId).toBeTruthy();
    expect(mesh.connectedPeerIds).toEqual([]);
  });

  it('creates an offer blob', async () => {
    const mesh = new WebRTCMesh();
    const blobJson = await mesh.createOffer();
    const blob = JSON.parse(blobJson) as { type: string; from: string; sdp: string };
    expect(blob.type).toBe('offer');
    expect(blob.from).toBe(mesh.localId);
    expect(blob.sdp).toBe('fake-offer');
  });

  it('requests approval on offer reception', () => {
    const onApproval = vi.fn();
    const mesh = new WebRTCMesh({ onApprovalRequired: onApproval });
    mesh.receiveOffer(JSON.stringify({
      type: 'offer',
      from: 'peer-1',
      fromName: 'Peer',
      to: mesh.localId,
      sdp: 'fake',
      candidates: [],
    }));
    expect(onApproval).toHaveBeenCalledWith(expect.objectContaining({
      peerId: 'peer-1',
      peerName: 'Peer',
    }));
  });

  it('rejects non-offer blobs', () => {
    const mesh = new WebRTCMesh();
    expect(() => mesh.receiveOffer(JSON.stringify({ type: 'answer' }))).toThrow('Expected offer blob');
  });

  it('creates an answer after approval', async () => {
    const mesh = new WebRTCMesh({ peerName: 'B' });
    const answer = await mesh.approveAndCreateAnswer(JSON.stringify({
      type: 'offer',
      from: 'peer-1',
      fromName: 'Peer',
      to: mesh.localId,
      sdp: 'fake',
      candidates: [],
    }));
    const blob = JSON.parse(answer) as { type: string; from: string };
    expect(blob.type).toBe('answer');
    expect(blob.from).toBe(mesh.localId);
  });

  it('accepts an answer and tracks the peer', async () => {
    const meshA = new WebRTCMesh({ peerName: 'A' });
    const meshB = new WebRTCMesh({ peerName: 'B' });

    const offerJson = await meshA.createOffer();
    const answerJson = await meshB.approveAndCreateAnswer(offerJson);
    await meshA.acceptAnswer(answerJson);

    expect(meshA.connectedPeerIds).toContain(meshB.localId);
  });

  it('broadcasts messages without throwing', async () => {
    const mesh = new WebRTCMesh({ peerName: 'A' });
    await mesh.createOffer();
    expect(() =>
      mesh.broadcast({ type: 'cursor', data: { x: 0, y: 0, userId: 'u1', userName: 'U', color: '#000' } }),
    ).not.toThrow();
  });

  it('disconnects all peers without throwing', async () => {
    const mesh = new WebRTCMesh();
    await mesh.createOffer();
    expect(() => mesh.disconnectAll()).not.toThrow();
  });
});

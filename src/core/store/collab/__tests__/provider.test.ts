import { describe, expect, it, vi } from 'vitest';
import { ProjectCollabDoc } from '../provider';

describe('ProjectCollabDoc', () => {
  it('creates a doc for a project and stores awareness', () => {
    const doc = new ProjectCollabDoc('proj-1', { id: 'u1', name: 'Alice', color: '#ff0000' });
    expect(doc.projectId).toBe('proj-1');
    expect(doc.destroyed).toBe(false);
    expect(doc.awareness.get('u1')).toEqual(
      expect.objectContaining({ user: { id: 'u1', name: 'Alice', color: '#ff0000' } }),
    );
    doc.destroy();
  });

  it('emits updates through transport when local changes occur', () => {
    const send = vi.fn();
    const doc = new ProjectCollabDoc('proj-1', { id: 'u1', name: 'Alice', color: '#ff0000' });
    doc.connectTransport(send);

    const map = doc.doc.getMap('test');
    map.set('key', 'value');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
    doc.destroy();
  });

  it('does not emit updates after disconnectTransport', () => {
    const send = vi.fn();
    const doc = new ProjectCollabDoc('proj-1', { id: 'u1', name: 'Alice', color: '#ff0000' });
    doc.connectTransport(send);
    doc.disconnectTransport();

    const map = doc.doc.getMap('test');
    map.set('key', 'value');

    expect(send).not.toHaveBeenCalled();
    doc.destroy();
  });

  it('applies remote updates without echoing them back', () => {
    const sendA = vi.fn();
    const docA = new ProjectCollabDoc('proj-1', { id: 'u1', name: 'Alice', color: '#ff0000' });
    docA.connectTransport(sendA);

    const update = docA.encodeStateAsUpdate();

    const docB = new ProjectCollabDoc('proj-1', { id: 'u2', name: 'Bob', color: '#00ff00' });
    docB.applyUpdate(update);

    expect(docB.doc.getMap('awareness').get('u1')).toBeDefined();
    docA.destroy();
    docB.destroy();
  });

  it('marks destroyed after destroy()', () => {
    const doc = new ProjectCollabDoc('proj-1', { id: 'u1', name: 'Alice', color: '#ff0000' });
    doc.destroy();
    expect(doc.destroyed).toBe(true);
  });
});

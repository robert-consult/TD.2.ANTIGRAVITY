describe('native websocket service', () => {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    static instances: MockWebSocket[] = [];

    readonly url: string;
    readyState = MockWebSocket.CONNECTING;
    onopen: ((event?: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: ((error?: unknown) => void) | null = null;
    sent: string[] = [];

    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }

    send(payload: string) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: 'closed' });
    }
  }

  beforeEach(() => {
    jest.resetModules();
    MockWebSocket.instances = [];
    jest.useFakeTimers();
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).WebSocket;
  });

  it('does not create duplicate sockets when enable is called repeatedly', () => {
    let wsService: any;

    jest.isolateModules(() => {
      wsService = require('../src/services/websocket').wsService;
    });

    wsService.enable();
    wsService.enable();
    expect(MockWebSocket.instances).toHaveLength(1);

    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    wsService.enable();
    expect(MockWebSocket.instances).toHaveLength(1);

    wsService.disable();
  });
});

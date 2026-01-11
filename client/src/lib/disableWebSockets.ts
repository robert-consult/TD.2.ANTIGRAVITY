/**
 * This module disables WebSocket connections that may be attempted by the application
 * Since we are using 1Forge's Starter tier which only supports REST API (and not WebSockets),
 * we need to prevent any WebSocket connection attempts.
 */

// Define a module that will be used in the main entry point
export function disableWebSocketConnections() {
  // Store the original WebSocket constructor
  const OriginalWebSocket = window.WebSocket;
  
  // Override the WebSocket constructor to block ALL WebSocket connections
  window.WebSocket = function(url: string, protocols?: string | string[]) {
    // Log the attempt
    console.log("WebSocket connection attempted:", url);
    
    // Create a mock WebSocket that immediately emits a close event
    const mockWs = {
      url,
      readyState: 3, // CLOSED
      protocol: '',
      extensions: '',
      bufferedAmount: 0,
      binaryType: 'blob',
      onopen: null as any,
      onclose: null as any,
      onmessage: null as any,
      onerror: null as any,
      close: () => {},
      send: () => { throw new Error('Cannot send on closed WebSocket'); },
      addEventListener: (type: string, listener: any) => {
        // If this is a connect attempt, immediately trigger error and close events
        if (type === 'open') {
          setTimeout(() => {
            const errorEvent = new Event('error');
            if (mockWs.onerror) mockWs.onerror(errorEvent);
            
            const closeEvent = new CloseEvent('close', { 
              wasClean: false, 
              code: 1006, 
              reason: '' 
            });
            if (mockWs.onclose) mockWs.onclose(closeEvent);
            
            listener({ target: mockWs });
          }, 0);
        }
      },
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as any;
    
    // Simulate an error event in the next tick
    setTimeout(() => {
      const errorEvent = { isTrusted: true } as any;
      console.log("WebSocket error:", errorEvent);
      if (mockWs.onerror) mockWs.onerror(errorEvent);
      
      const closeEvent = { 
        code: 1006, 
        reason: '',
        wasClean: false
      } as any;
      console.log("WebSocket disconnected:", closeEvent.code, closeEvent.reason);
      if (mockWs.onclose) mockWs.onclose(closeEvent);
    }, 0);
    
    return mockWs;
  } as any;
  
  // No need to copy constants as they're read-only properties
  // The original values will still be available
  
  console.log("WebSocket completely disabled - 1Forge Starter tier compatibility mode active");
}